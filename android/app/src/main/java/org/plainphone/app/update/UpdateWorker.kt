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
            Result.success()
        } catch (e: Exception) {
            Log.e("Plainphone", "self-update crashed", e)
            Result.success() // the next periodic run tries again; no tight retry loop
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

    /** Every 6 hours with any network; the updater itself keeps to one full check a day. */
    fun ensurePeriodic(context: Context) {
        val request = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInitialDelay(10, TimeUnit.MINUTES)
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    /** The parent pressed "Update now" in the dashboard. */
    fun now(context: Context) {
        val request = OneTimeWorkRequestBuilder<UpdateWorker>()
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(workDataOf(UpdateWorker.KEY_FORCE to true))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, request)
    }

    /** For the status report. */
    fun report(context: Context): UpdateReport? = PrefsUpdateStateStore(context.applicationContext).report
}

class PrefsUpdateStateStore(context: Context) : UpdateStateStore {
    private val prefs = context.getSharedPreferences("plainphone_update", Context.MODE_PRIVATE)

    override var lastCheckMs: Long
        get() = prefs.getLong("last_check", 0L)
        set(v) { prefs.edit().putLong("last_check", v).apply() }

    override var handledRequestMs: Long
        get() = prefs.getLong("handled_request", 0L)
        set(v) { prefs.edit().putLong("handled_request", v).apply() }

    override var report: UpdateReport?
        get() = prefs.getString("state", null)?.let {
            UpdateReport(
                it,
                prefs.getString("detail", null),
                prefs.getLong("checked_at", 0L).takeIf { t -> t > 0 },
                prefs.getString("latest", null),
            )
        }
        set(r) {
            val e = prefs.edit()
            if (r == null) {
                e.remove("state").remove("detail").remove("checked_at").remove("latest")
            } else {
                e.putString("state", r.state).putString("detail", r.detail).putLong("checked_at", r.checkedAtMs ?: 0L)
                    .putString("latest", r.latestVersionName)
            }
            e.apply()
        }
}
