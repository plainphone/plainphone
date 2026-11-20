// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.os.BatteryManager
import android.util.Log
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.util.concurrent.TimeUnit
import org.plainphone.app.light.Mode

/**
 * Looks every half hour, while the phone charges on an unmetered network, whether tonight's app
 * update window is due (AppUpdateNight). Charging means no Doze, so the checks run on time.
 */
class AppUpdateWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        val app = applicationContext
        if (AppUpdateWindow.openNightlyIfDue(app, conditions(app))) {
            org.plainphone.app.sync.SyncScheduler.now(app, "app update window opened")
        }
        Result.success()
    } catch (e: Exception) {
        Log.e("Plainphone", "nightly app update check failed", e)
        Result.success()
    }

    companion object {
        private const val PERIODIC = "plainphone-app-updates-nightly"

        fun schedule(context: Context) {
            val request = PeriodicWorkRequestBuilder<AppUpdateWorker>(30, TimeUnit.MINUTES)
                .setConstraints(
                    Constraints.Builder()
                        .setRequiresCharging(true)
                        .setRequiredNetworkType(NetworkType.UNMETERED)
                        .build(),
                )
                .build()
            WorkManager.getInstance(context)
                .enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
        }

        fun conditions(context: Context): AppUpdateNight.Conditions {
            val battery = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
            val plugged = (battery?.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) ?: 0) != 0
            val cm = context.getSystemService(ConnectivityManager::class.java)
            val caps = cm?.getNetworkCapabilities(cm.activeNetwork)
            return AppUpdateNight.Conditions(
                enabled = AppUpdateWindow.automatic(context),
                strong = Mode.isStrong(context),
                charging = plugged,
                unmetered = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == true,
            )
        }
    }
}
