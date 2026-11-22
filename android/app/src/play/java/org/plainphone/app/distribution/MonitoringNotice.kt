// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.distribution

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import org.plainphone.app.R
import org.plainphone.app.light.LightRelease
import org.plainphone.app.safety.SharingActivity
import org.plainphone.app.sync.SyncStore

/**
 * Google Play's monitoring-app policy asks for "a persistent notification at all times when the app
 * is running". From pairing until Plainphone is switched off, one quiet notification says that the
 * parents' rules apply, and a tap opens "What can my parents see?". Low importance: no sound, no
 * badge, no pop-up. Swiped away (Android 14 allows that), it comes back at once.
 */
internal object MonitoringNotice {
    const val CHANNEL = "plainphone-on"
    const val ID = 4300

    /** Paired with a dashboard and not switched off: the parents see and set something. */
    fun active(context: Context): Boolean {
        val sync = SyncStore(context)
        return sync.isPaired && !sync.released && !sync.removed && !LightRelease.isReleased(context)
    }

    fun update(context: Context) {
        runCatching { show(context, active(context)) }
            .onFailure { Log.w("Plainphone", "could not update the Plainphone-is-on notice", it) }
    }

    private fun show(context: Context, on: Boolean) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (!on) {
            nm.cancel(ID)
            return
        }
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.monitoring_channel), NotificationManager.IMPORTANCE_LOW)
                .apply { setShowBadge(false) },
        )
        if (nm.activeNotifications.any { it.id == ID && it.tag == null }) return
        val body = context.getString(R.string.monitoring_body)
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.monitoring_title))
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setContentIntent(
                PendingIntent.getActivity(
                    context, ID,
                    SharingActivity.intent(context).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
                ),
            )
            .setDeleteIntent(
                PendingIntent.getBroadcast(
                    context, ID, Intent(context, MonitoringNoticeReceiver::class.java), PendingIntent.FLAG_IMMUTABLE,
                ),
            )
            .setCategory(Notification.CATEGORY_STATUS)
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .build()
        nm.notify(ID, n)
    }
}

/** The notice was swiped away: put it back while Plainphone still looks after the phone. */
class MonitoringNoticeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) = MonitoringNotice.update(context)
}
