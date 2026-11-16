// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import java.text.DateFormat
import java.util.Date
import java.util.concurrent.Executors

/** Glue between Android entry points and [PolicyApplier]. */
object Lock {
    private const val TAG = "Plainphone"
    private val executor = Executors.newSingleThreadExecutor()

    fun applier(context: Context) = PolicyApplier(
        AndroidDeviceControls(context.applicationContext),
        PrefsHiddenAppsStore(context.applicationContext),
        Build.VERSION.SDK_INT,
    )

    /** Applies the lock on a background thread (private DNS does network I/O). */
    fun applyAsync(context: Context, reason: String, done: ((List<StepResult>) -> Unit)? = null) {
        val app = context.applicationContext
        executor.execute {
            // done() must always run: provisioning and boot broadcasts wait for it.
            val results = guarded("apply") { applyNow(app, reason) }
            done?.invoke(results)
        }
    }

    /** Blocking. Never call on the main thread. */
    fun applyNow(context: Context, reason: String): List<StepResult> {
        val config = ConfigStore(context).load()
        val results = applier(context).apply(config)
        clearMaintenanceWindow(context)
        saveReport(context, "apply ($reason)", results)
        return results
    }

    fun liftAsync(context: Context, done: (List<StepResult>) -> Unit) {
        val app = context.applicationContext
        executor.execute {
            val results = guarded("lift") {
                val minutes = ConfigStore(app).load().relockMinutes
                scheduleRelock(app, minutes)
                applier(app).lift().also { saveReport(app, "maintenance unlock for $minutes min", it) }
            }
            done(results)
        }
    }

    fun releaseAsync(context: Context, done: (List<StepResult>) -> Unit) {
        val app = context.applicationContext
        executor.execute {
            val results = guarded("release") {
                cancelRelock(app)
                applier(app).release().also { saveReport(app, "released Device Owner", it) }
            }
            done(results)
        }
    }

    private inline fun guarded(name: String, block: () -> List<StepResult>): List<StepResult> = try {
        block()
    } catch (e: Exception) {
        Log.e(TAG, "$name crashed", e)
        listOf(StepResult(name, false, "${e.javaClass.simpleName}: ${e.message}"))
    }

    fun isInMaintenanceWindow(context: Context): Boolean =
        prefs(context).getLong("relock_at_wall", 0L) > System.currentTimeMillis()

    fun lastReport(context: Context): String =
        prefs(context).getString("last_report", null) ?: "No policy run yet."

    private fun scheduleRelock(context: Context, minutes: Int) {
        val delayMs = minutes * 60_000L
        context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + delayMs,
            relockIntent(context),
        )
        prefs(context).edit().putLong("relock_at_wall", System.currentTimeMillis() + delayMs).apply()
    }

    private fun cancelRelock(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(relockIntent(context))
        clearMaintenanceWindow(context)
    }

    private fun clearMaintenanceWindow(context: Context) {
        prefs(context).edit().remove("relock_at_wall").apply()
    }

    private fun relockIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, RelockReceiver::class.java).setAction(RelockReceiver.ACTION_RELOCK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun saveReport(context: Context, title: String, results: List<StepResult>) {
        val stamp = DateFormat.getDateTimeInstance().format(Date())
        val text = buildString {
            appendLine("$title, $stamp")
            results.forEach { appendLine(it.toString()) }
        }
        results.forEach { Log.i(TAG, it.toString()) }
        prefs(context).edit().putString("last_report", text).apply()
    }

    private fun prefs(context: Context) = context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE)
}

class PrefsHiddenAppsStore(context: Context) : HiddenAppsStore {
    private val prefs = context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE)
    override fun load(): Set<String> = prefs.getStringSet("hidden_apps", null)?.toSet() ?: emptySet()
    override fun save(packages: Set<String>) {
        prefs.edit().putStringSet("hidden_apps", packages).apply()
    }
}
