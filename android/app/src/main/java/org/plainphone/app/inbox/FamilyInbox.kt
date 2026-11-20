// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.inbox

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.R
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.sos.QuickMessageDelivery
import org.plainphone.app.sos.SendState
import org.plainphone.app.sos.SilentSos
import org.plainphone.app.sync.InboxMessage
import org.plainphone.app.sync.InboxRules
import org.plainphone.app.sync.InboxSend
import org.plainphone.app.sync.InboxThread
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.sync.QuickMessages
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.telephony.CallNotifications
import org.plainphone.app.ui.PhoneActivity

/** One line of the thread as the child sees it. */
data class InboxEntry(
    val key: String,
    val fromChild: Boolean,
    val text: String,
    val atMs: Long,
    val kind: String,
    /** Child messages: where it is. */
    val state: SendState? = null,
    /** Parent replies: who wrote it. */
    val author: String? = null,
)

/** What the family inbox offers the child right now, from the rules. Null: the inbox is off. */
data class InboxOffer(val quick: List<QuickMessage>, val checkIns: Boolean)

/**
 * The family inbox on the child's phone (docs/family-inbox.md): one thread with the parents. The
 * server's copy of the thread is cached here, next to a short local outbox of what this phone sent,
 * so a message shows at once and its state follows it (sending, delivered, sent as SMS, not sent).
 * Code words go through SOS and stay only in this local outbox, looking like any other message.
 */
object FamilyInbox {
    /** How many local sends are kept; the server keeps the thread itself. */
    private const val OUTBOX_MAX = 30
    private const val KEEP_MS = 30 * 86_400_000L
    private const val NOTIFICATION_ID = 3

    private val _changes = MutableStateFlow(0)
    /** Bumped when the thread or the outbox changes, so an open screen reloads. */
    val changes: StateFlow<Int> = _changes.asStateFlow()

    private fun prefs(context: Context) = context.getSharedPreferences("plainphone_family_inbox", Context.MODE_PRIVATE)

    fun rules(context: Context): InboxRules {
        val rules = SyncStore(context).rules() ?: return InboxRules.OFF
        return if (rules.profile == "child" && !rules.release) rules.inbox else InboxRules.OFF
    }

    /** The quick messages and check-in the inbox offers, or null while it is off. */
    fun offer(context: Context): InboxOffer? {
        val inbox = rules(context)
        if (!inbox.enabled) return null
        val quick = SilentSos.childSos(SyncStore(context).rules())?.quickMessages ?: QuickMessages.NONE
        return InboxOffer(if (inbox.quickMessages && quick.enabled) quick.items else emptyList(), inbox.checkIns)
    }

    fun thread(context: Context): InboxThread =
        prefs(context).getString("thread", null)?.let { runCatching { InboxThread.parse(JSONObject(it)) }.getOrNull() } ?: InboxThread.EMPTY

    /** Sends a quick message from the inbox. Returns false when it could not be queued. */
    fun send(context: Context, message: QuickMessage, nowMs: Long = System.currentTimeMillis()): Boolean {
        val key = QuickMessageDelivery.send(context, message, InboxSend(InboxSend.QUICK, nowMs)) ?: return false
        remember(context, key, message.text, InboxSend.QUICK, nowMs)
        return true
    }

    /** "I'm home", without a position. */
    fun checkIn(context: Context, nowMs: Long = System.currentTimeMillis()): Boolean {
        val text = context.getString(R.string.inbox_check_in_text)
        val key = QuickMessageDelivery.send(context, QuickMessage("checkin", text, meansSos = false), InboxSend(InboxSend.CHECK_IN, nowMs))
            ?: return false
        remember(context, key, text, InboxSend.CHECK_IN, nowMs)
        return true
    }

    private fun remember(context: Context, key: String, text: String, kind: String, atMs: Long) {
        val kept = outbox(context).filter { atMs - it.getLong("at") < KEEP_MS }.takeLast(OUTBOX_MAX - 1)
        val list = JSONArray()
        kept.forEach(list::put)
        list.put(JSONObject().put("key", key).put("text", text).put("kind", kind).put("at", atMs))
        prefs(context).edit().putString("outbox", list.toString()).apply()
        _changes.value++
    }

    private fun outbox(context: Context): List<JSONObject> = runCatching {
        val a = JSONArray(prefs(context).getString("outbox", "[]"))
        List(a.length()) { a.getJSONObject(it) }
    }.getOrDefault(emptyList())

    /** The thread as the child sees it: the server's copy and what is still only on this phone, oldest first. */
    fun entries(context: Context): List<InboxEntry> = merge(
        thread(context),
        outbox(context).map { Triple(it.getString("key"), it, QuickMessageDelivery.state(context, it.getString("key"))) },
    )

    internal fun merge(thread: InboxThread, local: List<Triple<String, JSONObject, SendState>>): List<InboxEntry> {
        val localByServerId = local.associateBy { it.first.substringAfter(':') }
        val fromServer = thread.messages.map { m ->
            val mine = localByServerId[m.id]
            InboxEntry(
                key = m.id, fromChild = m.fromChild, text = m.text, atMs = m.sentAtMs, kind = m.kind,
                state = if (!m.fromChild) null else mine?.third?.takeIf { it != SendState.SENDING } ?: when (m.delivered) {
                    null -> SendState.SENT
                    0 -> SendState.SMS
                    else -> SendState.DELIVERED
                },
                author = m.author,
            )
        }
        val onServer = thread.messages.map { it.id }.toSet()
        val onlyHere = local.filter { it.first.substringAfter(':') !in onServer }.map { (key, o, state) ->
            InboxEntry(key, true, o.getString("text"), o.getLong("at"), o.optString("kind", InboxSend.QUICK), state)
        }
        return (fromServer + onlyHere).sortedBy { it.atMs }
    }

    /**
     * From the sync: fetch the thread when the newest reply changed, send the device receipt for
     * replies this phone now has, and tell the child about new ones. Quiet at bedtime.
     */
    fun refresh(context: Context, api: PlainphoneApi, token: String, rules: ServerRules) {
        val inbox = if (rules.profile == "child" && !rules.release) rules.inbox else InboxRules.OFF
        val p = prefs(context)
        if (!inbox.enabled) return
        if (inbox.latest == p.getString("latest", null) && p.contains("thread")) return
        val thread = api.fetchInbox(token)
        val seen = p.getStringSet("received", emptySet()).orEmpty()
        val replies = thread.messages.filter { !it.fromChild }
        val fresh = replies.filter { it.id !in seen }
        api.inboxReceived(token, fresh.map { it.id })
        val json = JSONObject().put("recipients", JSONArray(thread.recipients))
            .put("messages", JSONArray().apply { thread.messages.forEach { put(it.toJson()) } })
        p.edit().putString("thread", json.toString()).putString("latest", inbox.latest)
            .putStringSet("received", replies.map { it.id }.toSet()).apply()
        _changes.value++
        // The first fetch after the inbox is switched on is old news, not a new message.
        if (seen.isNotEmpty() || p.getBoolean("notified-once", false)) fresh.lastOrNull()?.let { notify(context, it) }
        p.edit().putBoolean("notified-once", true).apply()
    }

    private fun notify(context: Context, reply: InboxMessage) {
        CallNotifications.createChannels(context)
        val quiet = ContactPolicySources.get(context).rules().silentBedtime
        val open = PendingIntent.getActivity(
            context, NOTIFICATION_ID, PhoneActivity.familyIntent(context),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val title = reply.author?.let { context.getString(R.string.inbox_notification_from, it) }
            ?: context.getString(R.string.inbox_title)
        val n = Notification.Builder(context, if (quiet) CallNotifications.CHANNEL_QUIET else CallNotifications.CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(title)
            .setContentText(reply.text)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { context.getSystemService(NotificationManager::class.java).notify(NOTIFICATION_ID, n) }
    }

    fun cancelNotification(context: Context) {
        runCatching { context.getSystemService(NotificationManager::class.java).cancel(NOTIFICATION_ID) }
    }
}
