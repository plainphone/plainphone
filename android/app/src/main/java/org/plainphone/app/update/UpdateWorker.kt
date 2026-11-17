// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.Context
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

/** Runs [SelfUpdater]. Periodic (it skips until a day has passed) and on the parent's "Update now". */
class UpdateWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val force = inputData.getBoolean(KEY_FORCE, false)
        return try {
            val outcome = SelfUpdate.updater(applicationContext).run(force)
            Log.i("Plainphone", "self-update (${if (force) "requested" else "periodic"}): $outcome")
            if (outcome !is SelfUpdater.Outcome.Skipped) {
                org.plainphone.app.sync.SyncScheduler.now(applicationContext, "update check")
            }
            if (force && outcome is SelfUpdater.Outcome.Skipped) Result.retry() else Result.success()
        } catch (e: Exception) {
            Log.e("Plainphone", "self-update crashed", e)
            PrefsUpdateStateStore(applicationContext).report = UpdateReport(
                SelfUpdater.STATE_FAILED, e.message ?: e.javaClass.simpleName, System.currentTimeMillis(), null,
            )
            org.plainphone.app.sync.SyncScheduler.now(applicationContext, "update check failed")
            Result.success()
        }
    }

    companion object {
        const val KEY_FORCE = "force"
    }
}

object SelfUpdate {
    private const val PERIODIC = "plainphone-update-periodic"
    private const val NOW = "plainphone-update-now"

    fun updater(context: Context): SelfUpdater {
        val app = context.applicationContext
        return SelfUpdater(AndroidUpdateHost(app), PrefsUpdateStateStore(app), InstallLease.android(app))
    }

    fun onStart(context: Context) {
        val store = PrefsUpdateStateStore(context)
        val target = store.installingVersionCode
        if (target > 0L) {
            val installed = AndroidUpdateHost(context).installed()
            store.report = if (installed.versionCode >= target) {
                UpdateReport(SelfUpdater.STATE_UP_TO_DATE, null, System.currentTimeMillis(), installed.versionName)
            } else {
                UpdateReport(SelfUpdater.STATE_FAILED, "installation was interrupted", System.currentTimeMillis(), store.report?.latestVersionName)
            }
            store.installingVersionCode = 0L
            org.plainphone.app.sync.SyncScheduler.now(context, "update result")
        }

        val report = store.report
        if (report?.state == SelfUpdater.STATE_PROMPTED) {
            val host = AndroidUpdateHost(context)
            val reconciled = report.reconcileInstalled(host.installed())
            if (reconciled != report) {
                store.report = reconciled
                host.clearUpdatePrompt()
                org.plainphone.app.sync.SyncScheduler.now(context, "manual update installed")
            }
        }

        // WorkManager combines constraints with AND. Poll more often than the shared daily
        // gate, so a check by one worker does not cost the other worker an entire day.
        schedule(context, PERIODIC, Constraints.Builder().setRequiredNetworkType(NetworkType.UNMETERED).build())
        schedule(context, "$PERIODIC-charging", Constraints.Builder()
            .setRequiredNetworkType(NetworkType.CONNECTED).setRequiresCharging(true).build())
    }

    private fun schedule(context: Context, name: String, constraints: Constraints) {
        val request = PeriodicWorkRequestBuilder<UpdateWorker>(1, TimeUnit.HOURS)
            .setConstraints(constraints)
            .setInitialDelay(10, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(name, ExistingPeriodicWorkPolicy.UPDATE, request)
    }

    /** Persist the work before marking the timestamp handled; a replay uses the same unique name. */
    @Synchronized
    fun request(context: Context, requestedAtMs: Long) {
        val store = PrefsUpdateStateStore(context)
        if (requestedAtMs <= store.handledRequestMs) return
        val request = OneTimeWorkRequestBuilder<UpdateWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf(UpdateWorker.KEY_FORCE to true))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("$NOW-$requestedAtMs", ExistingWorkPolicy.KEEP, request)
            .result.get(10, TimeUnit.SECONDS)
        store.handledRequestMs = requestedAtMs
    }

    /** For the status report. */
    fun report(context: Context): UpdateReport? = PrefsUpdateStateStore(context.applicationContext).report
}

class PrefsUpdateStateStore(context: Context) : UpdateStateStore {
    private val prefs = context.getSharedPreferences("plainphone_update", Context.MODE_PRIVATE)

    override var installingVersionCode: Long
        get() = prefs.getLong("installing_version", 0L)
        @android.annotation.SuppressLint("ApplySharedPref")
        set(v) { check(prefs.edit().putLong("installing_version", v).commit()) }

    override var lastCheckMs: Long
        get() = prefs.getLong("last_check", 0L)
        set(v) { prefs.edit().putLong("last_check", v).apply() }

    override var handledRequestMs: Long
        get() = prefs.getLong("handled_request", 0L)
        @android.annotation.SuppressLint("ApplySharedPref")
        set(v) { check(prefs.edit().putLong("handled_request", v).commit()) }

    override var report: UpdateReport?
        get() = prefs.getString("state", null)?.let {
            UpdateReport(
                it,
                prefs.getString("detail", null),
                prefs.getLong("checked_at", 0L).takeIf { t -> t > 0 },
                prefs.getString("latest", null),
                prefs.getLong("prompted_version", 0L).takeIf { code -> code > 0L },
            )
        }
        set(r) {
            val e = prefs.edit()
            if (r == null) {
                e.remove("state").remove("detail").remove("checked_at").remove("latest").remove("prompted_version")
            } else {
                e.putString("state", r.state).putString("detail", r.detail).putLong("checked_at", r.checkedAtMs ?: 0L)
                    .putString("latest", r.latestVersionName).putLong("prompted_version", r.promptedVersionCode ?: 0L)
            }
            e.apply()
        }
}
