// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import java.util.Date
import org.plainphone.app.R
import org.plainphone.app.sync.CheckInRequest
import org.plainphone.app.sync.SafetyEvent
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.isInteractive

/**
 * "Ring the phone", "Are you okay?" and the location notices on the phone (docs/location.md).
 * Called after every sync with the current rules; everything here is idempotent.
 */
object Safety {
    private const val TAG = "Plainphone"
    const val CHANNEL_RING = "safety_ring"
    const val CHANNEL_CHECKIN = "safety_checkin"
    const val CHANNEL_LOCATION = "location"
    const val ID_RING = 4100
    const val ID_CHECKIN = 4101
    const val ID_LOCATION_SENT = 4102
    const val ID_LOCATION_ALWAYS = 4103

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        nm.createNotificationChannels(
            listOf(
                // The ring service plays the sound itself on the alarm stream.
                NotificationChannel(CHANNEL_RING, context.getString(R.string.safety_channel_ring), NotificationManager.IMPORTANCE_HIGH)
                    .apply { setSound(null, null); enableVibration(false) },
                NotificationChannel(CHANNEL_CHECKIN, context.getString(R.string.safety_channel_checkin), NotificationManager.IMPORTANCE_HIGH),
                // Quiet but always visible: the child can see whenever a position is shared.
                NotificationChannel(CHANNEL_LOCATION, context.getString(R.string.safety_channel_location), NotificationManager.IMPORTANCE_LOW),
            ),
        )
    }

    /** Brings the phone in line with the rules: ring or not, question or not, "always" notice or not. */
    fun onRules(context: Context, rules: ServerRules, nowMs: Long = System.currentTimeMillis()) {
        val store = SafetyStore(context)

        val ring = rules.ring
        val ringOn = ring != null && nowMs < ring.endsAt.toEpochMilli() && !store.ringFinished(ring.id) &&
            !(ring.stopOnAnswer && (ring.answered || store.ringAnswered(ring.id)))
        if (ringOn) RingService.start(context, ring) else RingService.stop(context)

        val c = rules.checkIn
        if (c != null && nowMs < c.deadline.toEpochMilli() && !store.checkInAnswered(c.id)) {
            showCheckIn(context, c)
            scheduleWake(context, c.deadline.toEpochMilli() + 2_000L, REQ_DEADLINE)
        } else {
            closeCheckIn(context)
        }

        val always = rules.locationMode == ServerRules.LOCATION_ALWAYS
        store.locationMode = rules.locationMode
        val until = if (always) rules.locationAlwaysUntil?.toEpochMilli() else null
        if (always != store.sharingAlways || until != store.alwaysUntilMs || always) {
            store.sharingAlways = always
            store.alwaysUntilMs = until
            showAlways(context, always, until)
        }
    }

    // --- "Are you okay?" ---------------------------------------------------------------

    private fun showCheckIn(context: Context, c: CheckInRequest) {
        val store = SafetyStore(context)
        val open = PendingIntent.getActivity(
            context, ID_CHECKIN,
            Intent(context, CheckInActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val first = !store.checkInShown(c.id)
        val n = Notification.Builder(context, CHANNEL_CHECKIN)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.checkin_title))
            .setContentText(context.getString(R.string.checkin_notice, time(context, c.deadline.toEpochMilli())))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .build()
        context.getSystemService(NotificationManager::class.java)?.notify(ID_CHECKIN, n)
        if (first) {
            // The full-screen intent shows it on a locked or sleeping phone; in use, open it directly.
            runCatching { context.startActivity(Intent(context, CheckInActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
                .onFailure { Log.i(TAG, "check-in screen via notification only: ${it.message}") }
        }
    }

    fun closeCheckIn(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(ID_CHECKIN)
        CheckInActivity.closeAll()
    }

    /** The child answered on the phone: remember it, tell the server, close the question. */
    fun answerCheckIn(context: Context, id: String, answer: String) {
        val store = SafetyStore(context)
        store.markCheckInAnswered(id)
        store.add(SafetyEvent(id, answer))
        closeCheckIn(context)
        SyncScheduler.now(context, "check-in answered")
    }

    fun checkInShown(context: Context, id: String) {
        val store = SafetyStore(context)
        if (store.checkInShown(id)) return
        store.markCheckInShown(id)
        store.add(SafetyEvent(id, "shown"))
        SyncScheduler.now(context, "check-in shown")
    }

    /** The open check-in from the last rules, if it still waits for an answer. */
    fun currentCheckIn(context: Context, nowMs: Long = System.currentTimeMillis()): CheckInRequest? {
        val c = SyncStore(context).rules()?.checkIn ?: return null
        if (nowMs >= c.deadline.toEpochMilli() || SafetyStore(context).checkInAnswered(c.id)) return null
        return c
    }

    // --- Location notices --------------------------------------------------------------

    /** A single position went to the parent (Find, or an unanswered "Are you okay?"). */
    fun positionSent(context: Context, why: String, nowMs: Long = System.currentTimeMillis()) {
        SafetyStore(context).logPosition(why, nowMs)
        if (why == "always") return // the ongoing notice says it already
        val text = context.getString(
            if (why == "checkin") R.string.location_sent_checkin else R.string.location_sent_find,
            time(context, nowMs),
        )
        val n = Notification.Builder(context, CHANNEL_LOCATION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.location_sent_title))
            .setContentText(text)
            .setStyle(Notification.BigTextStyle().bigText(text))
            .setShowWhen(true)
            .setOnlyAlertOnce(true)
            .setAutoCancel(true)
            .setContentIntent(sharingPage(context))
            .build()
        context.getSystemService(NotificationManager::class.java)?.notify(ID_LOCATION_SENT, n)
    }

    private fun showAlways(context: Context, on: Boolean, untilMs: Long?) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (!on) {
            nm.cancel(ID_LOCATION_ALWAYS)
            return
        }
        val body = if (untilMs != null) {
            context.getString(R.string.location_always_body_until, dateTime(context, untilMs))
        } else {
            context.getString(R.string.location_always_body)
        }
        val title = context.getString(R.string.location_always_title)
        val active = nm.activeNotifications.firstOrNull { it.id == ID_LOCATION_ALWAYS && it.tag == null }
        if (active?.isOngoing == true &&
            active.notification.extras.getCharSequence(Notification.EXTRA_TITLE)?.toString() == title &&
            active.notification.extras.getCharSequence(Notification.EXTRA_TEXT)?.toString() == body
        ) return
        val n = Notification.Builder(context, CHANNEL_LOCATION)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setContentIntent(sharingPage(context))
            .setOngoing(true)
            .setShowWhen(false)
            .setOnlyAlertOnce(true)
            .build()
        nm.notify(ID_LOCATION_ALWAYS, n)
    }

    // --- Waking up without push --------------------------------------------------------

    /**
     * While the screen is off the phone looks for a ring or a question every [IDLE_POLL_MS]
     * (WorkManager alone allows only every 15 minutes). In deep sleep (Doze) Android stretches
     * these alarms to about every 9 to 15 minutes; push (FCM) would be the cure, and is not here.
     */
    fun scheduleIdlePoll(context: Context) {
        if (!SyncStore(context).isPaired) return
        scheduleWake(context, System.currentTimeMillis() + IDLE_POLL_MS, REQ_IDLE)
    }

    private fun scheduleWake(context: Context, atMs: Long, request: Int) {
        val am = context.getSystemService(AlarmManager::class.java) ?: return
        val pi = PendingIntent.getBroadcast(
            context, request,
            Intent(context, SafetyAlarmReceiver::class.java).putExtra(SafetyAlarmReceiver.EXTRA_KIND, request),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val exact = Build.VERSION.SDK_INT < 31 || am.canScheduleExactAlarms()
        val elapsed = SystemClock.elapsedRealtime() + (atMs - System.currentTimeMillis()).coerceAtLeast(0L)
        try {
            if (exact) am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsed, pi)
            else am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsed, pi)
        } catch (e: SecurityException) {
            am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, elapsed, pi)
        }
    }

    private fun time(context: Context, ms: Long): String =
        android.text.format.DateFormat.getTimeFormat(context).format(Date(ms))

    /** "14:05" today, otherwise "Tue 24 Nov 14:05". */
    fun dateTime(context: Context, ms: Long, nowMs: Long = System.currentTimeMillis()): String {
        val sameDay = android.text.format.DateUtils.isToday(ms) || kotlin.math.abs(ms - nowMs) < 60_000L
        return if (sameDay) time(context, ms) else android.text.format.DateUtils.formatDateTime(
            context, ms,
            android.text.format.DateUtils.FORMAT_SHOW_WEEKDAY or android.text.format.DateUtils.FORMAT_ABBREV_ALL or
                android.text.format.DateUtils.FORMAT_SHOW_DATE or android.text.format.DateUtils.FORMAT_SHOW_TIME,
        )
    }

    private fun sharingPage(context: Context): PendingIntent = PendingIntent.getActivity(
        context, ID_LOCATION_ALWAYS,
        Intent(context, SharingActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    const val IDLE_POLL_MS = 2 * 60_000L
    internal const val REQ_IDLE = 4200
    internal const val REQ_DEADLINE = 4201
}

/** The idle poll and the check-in deadline: sync now, and keep polling while the screen is off. */
class SafetyAlarmReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val kind = intent.getIntExtra(EXTRA_KIND, Safety.REQ_IDLE)
        if (kind == Safety.REQ_DEADLINE) Safety.closeCheckIn(context)
        SyncScheduler.now(context, if (kind == Safety.REQ_DEADLINE) "check-in deadline" else "idle poll")
        if (kind == Safety.REQ_IDLE && !isInteractive(context)) Safety.scheduleIdlePoll(context)
    }

    companion object {
        const val EXTRA_KIND = "kind"
    }
}
