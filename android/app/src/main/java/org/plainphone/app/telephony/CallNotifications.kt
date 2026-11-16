// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Person
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.telecom.Call
import org.plainphone.app.R
import org.plainphone.app.ui.InCallActivity
import org.plainphone.app.ui.PhoneActivity

/** Notifications for calls and messages. One channel each, so a parent can tune them in Settings. */
object CallNotifications {
    const val CHANNEL_CALLS = "calls"
    const val CHANNEL_MESSAGES = "messages"
    const val CHANNEL_BLOCKED = "blocked"
    private const val ID_CALL = 1
    private const val ID_BLOCKED = 2
    private const val ID_MESSAGE_BASE = 1000

    fun createChannels(context: Context) {
        val nm = context.getSystemService(NotificationManager::class.java)
        nm.createNotificationChannels(
            listOf(
                NotificationChannel(CHANNEL_CALLS, context.getString(R.string.channel_calls), NotificationManager.IMPORTANCE_HIGH)
                    .apply { setSound(null, null) }, // Telecom plays the ringtone.
                NotificationChannel(CHANNEL_MESSAGES, context.getString(R.string.channel_messages), NotificationManager.IMPORTANCE_HIGH),
                NotificationChannel(CHANNEL_BLOCKED, context.getString(R.string.channel_blocked), NotificationManager.IMPORTANCE_LOW),
            ),
        )
    }

    /** Shows the ringing or ongoing call, or removes the notification when no call is left. */
    fun update(context: Context) {
        createChannels(context)
        val nm = context.getSystemService(NotificationManager::class.java)
        val call = CallManager.primary()
        if (call == null) {
            nm.cancel(ID_CALL)
            return
        }
        val ui = CallManager.state.value.firstOrNull { it.id == System.identityHashCode(call) }
        val title = ui?.name ?: ui?.number ?: context.getString(R.string.call_unknown)
        val screen = PendingIntent.getActivity(
            context, 0,
            Intent(context, InCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val person = Person.Builder().setName(title).setImportant(true).build()
        val builder = Notification.Builder(context, CHANNEL_CALLS)
            .setSmallIcon(R.drawable.ic_plainphone)
            .setContentIntent(screen)
            .setOngoing(true)
            .setCategory(Notification.CATEGORY_CALL)
        if (call.details.state == Call.STATE_RINGING) {
            builder.setFullScreenIntent(screen, true)
                .setStyle(Notification.CallStyle.forIncomingCall(person, action(context, ACTION_DECLINE), answerIntent(context)))
        } else {
            builder.setFullScreenIntent(screen, false)
                .setStyle(Notification.CallStyle.forOngoingCall(person, action(context, ACTION_HANG_UP)))
        }
        runCatching { nm.notify(ID_CALL, builder.build()) }
    }

    fun showBlockedCall(context: Context, number: String?) {
        createChannels(context)
        val text = context.getString(R.string.call_blocked_text, number ?: context.getString(R.string.call_unknown))
        val n = Notification.Builder(context, CHANNEL_BLOCKED)
            .setSmallIcon(R.drawable.ic_plainphone)
            .setContentTitle(context.getString(R.string.call_blocked_title))
            .setContentText(text)
            .setAutoCancel(true)
            .build()
        runCatching { context.getSystemService(NotificationManager::class.java).notify(ID_BLOCKED, n) }
    }

    fun showMessage(context: Context, name: String, number: String, body: String) {
        createChannels(context)
        val open = PendingIntent.getActivity(
            context, number.hashCode(),
            PhoneActivity.conversationIntent(context, number),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = Notification.Builder(context, CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_plainphone)
            .setContentTitle(name)
            .setContentText(body)
            .setStyle(Notification.BigTextStyle().bigText(body))
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { context.getSystemService(NotificationManager::class.java).notify(ID_MESSAGE_BASE + (number.hashCode() and 0xffff), n) }
    }

    fun cancelMessage(context: Context, number: String) {
        context.getSystemService(NotificationManager::class.java).cancel(ID_MESSAGE_BASE + (number.hashCode() and 0xffff))
    }

    /** Answering opens the call screen, so it is an activity intent (Android blocks notification trampolines). */
    private fun answerIntent(context: Context): PendingIntent = PendingIntent.getActivity(
        context, 1,
        Intent(context, InCallActivity::class.java).setAction(ACTION_ANSWER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun action(context: Context, action: String): PendingIntent = PendingIntent.getBroadcast(
        context, action.hashCode(),
        Intent(context, CallActionReceiver::class.java).setAction(action),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    const val ACTION_ANSWER = "org.plainphone.app.ANSWER"
    const val ACTION_DECLINE = "org.plainphone.app.DECLINE"
    const val ACTION_HANG_UP = "org.plainphone.app.HANG_UP"
}

/** Buttons on the call notification. Not exported: only our own PendingIntents reach it. */
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            CallNotifications.ACTION_DECLINE -> CallManager.decline()
            CallNotifications.ACTION_HANG_UP -> CallManager.hangUp()
        }
    }
}
