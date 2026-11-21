// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import java.util.concurrent.Executors
import org.plainphone.app.Compat
import org.plainphone.app.R
import org.plainphone.app.sync.Schedules
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SyncStore

/**
 * Shows [LimitWarning]: one silent notification (no sound, no vibration, no badge, gone after
 * 5 minutes) and the same line on Plainphone's home screen. Without the notification permission
 * only the home screen line is left; nothing asks for the permission.
 */
object LimitWarningNotifier {
    const val CHANNEL = "time_warning"
    /** Above the range CallNotifications uses for message threads. */
    private const val ID = 200_100
    private const val TAG = "Plainphone"
    private val worker = Executors.newSingleThreadExecutor()

    /** Strong mode's minute tick: reads the app in front from the usage events, off the main thread. */
    fun checkAsync(context: Context) {
        val app = context.applicationContext
        worker.execute {
            runCatching { TimeGuard.snapshot(app)?.let { check(app, it, null) } }
                .onFailure { Log.w(TAG, "time warning: ${it.message}") }
        }
    }

    /** Warns once if [pkg] (or the app in front per [snap]) is about to run out. Call off the main thread. */
    fun check(context: Context, snap: TimeGuard.Snapshot, pkg: String?, now: TrustedTime = TrustedClock.of(context).now()) {
        val rules = SyncStore(context).rules() ?: return
        val front = pkg ?: snap.foreground ?: return
        val date = now.instant.atZone(rules.timezone).toLocalDate()
        val due = LimitWarning.due(snap.limits, snap.evaluation, front, date, snap.exempt, rules.limitWarningEnabled, quiet(rules, now))
            ?: return
        if (!LimitWarningMarks(context).claim(date, due)) return
        notify(context, text(context, due))
    }

    /** The home screen's line, or null. */
    fun banner(context: Context, snap: TimeGuard.Snapshot, now: TrustedTime = TrustedClock.of(context).now()): String? {
        val rules = SyncStore(context).rules() ?: return null
        val date = now.instant.atZone(rules.timezone).toLocalDate()
        val last = LimitWarningMarks(context).lastWarnedApp(date)
        return LimitWarning.banner(snap.limits, snap.evaluation, last, date, snap.exempt, rules.limitWarningEnabled, quiet(rules, now))
            ?.let { text(context, it) }
    }

    /** School time or bedtime: the windows already decide what is open, so no warning. */
    private fun quiet(rules: ServerRules, now: TrustedTime) = Schedules.active(rules.schedules, now, rules.timezone).isNotEmpty()

    fun text(context: Context, due: LimitWarning.Due): String {
        val n = LimitWarning.WINDOW_MINUTES
        return if (due.isTotal) {
            context.resources.getQuantityString(R.plurals.limit_warning_total, n, n)
        } else {
            context.resources.getQuantityString(R.plurals.limit_warning_app, n, n, label(context, due.target))
        }
    }

    private fun label(context: Context, pkg: String): String = runCatching {
        val pm = context.packageManager
        pm.getApplicationLabel(Compat.applicationInfo(pm, pkg, 0)).toString()
    }.getOrDefault(pkg)

    private fun notify(context: Context, text: String) {
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) return
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (!nm.areNotificationsEnabled()) return
        nm.createNotificationChannel(
            NotificationChannel(CHANNEL, context.getString(R.string.limit_warning_channel), NotificationManager.IMPORTANCE_LOW).apply {
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
                lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            },
        )
        val n = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(text)
            .setCategory(Notification.CATEGORY_REMINDER)
            .setVisibility(Notification.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setOnlyAlertOnce(true)
            .setTimeoutAfter(LimitWarning.WINDOW_MS)
            .build()
        runCatching { nm.notify(ID, n) }
    }
}
