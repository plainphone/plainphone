// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import org.plainphone.app.R
import org.plainphone.app.StepResult
import org.plainphone.app.batteryExemptionRequest
import org.plainphone.app.light.Mode

internal object UpdateBatteryExemption {
    const val FAILED_POLICY = "battery exemption missing: self-update cannot run"
    const val FIX = "Allow Plainphone to run in the background so it can update itself safely."
    private const val NOTIFICATION_ID = 106

    fun isMissing(context: Context) =
        Mode.isStrong(context) && !InstallWatchdogService.hasBatteryExemption(context)

    fun checkAndClearNotification(context: Context): Boolean {
        val missing = isMissing(context)
        if (!missing) context.getSystemService(NotificationManager::class.java)?.cancel(NOTIFICATION_ID)
        return missing
    }

    fun failure(context: Context): StepResult? =
        if (checkAndClearNotification(context)) StepResult(FAILED_POLICY, false, "Plainphone setup") else null

    fun setupRequest(context: Context): Intent? = if (isMissing(context)) batteryExemptionRequest(context) else null

    fun notify(context: Context) {
        if (!checkAndClearNotification(context)) return
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val manager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel = AndroidUpdateHost.CHANNEL
        manager.createNotificationChannel(
            NotificationChannel(channel, context.getString(R.string.channel_updates), NotificationManager.IMPORTANCE_LOW),
        )
        val open = PendingIntent.getActivity(
            context, NOTIFICATION_ID, batteryExemptionRequest(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val notification = Notification.Builder(context, channel)
            .setSmallIcon(R.drawable.ic_plainphone)
            .setContentTitle(context.getString(R.string.update_battery_required))
            .setContentText(context.getString(R.string.update_battery_reason))
            .setStyle(Notification.BigTextStyle().bigText(context.getString(R.string.update_battery_reason)))
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { manager.notify(NOTIFICATION_ID, notification) }
    }
}
