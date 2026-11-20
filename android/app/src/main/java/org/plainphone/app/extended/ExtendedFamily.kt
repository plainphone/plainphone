// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.extended

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.R
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.home.modeLabel
import org.plainphone.app.inbox.FamilyInbox
import org.plainphone.app.inbox.InboxEntry
import org.plainphone.app.sos.SendState
import org.plainphone.app.sos.SilentSos
import org.plainphone.app.sync.ContactStatus
import org.plainphone.app.sync.ExtendedContact
import org.plainphone.app.sync.ExtendedLine
import org.plainphone.app.sync.ExtendedRules
import org.plainphone.app.sync.ExtendedSendAnswer
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.LocationFix
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.sync.QuickMessages
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SnapshotRules
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.telephony.CallNotifications
import org.plainphone.app.ui.PhoneActivity

/**
 * Extended family contacts and location snapshots on the child's phone (docs/extended-family.md).
 * Keeps the roster the phone last saw (for the change list), what the child answered, the cached
 * conversations and an outbox. Pure decisions live in ExtendedLogic.kt; this class holds the state
 * and talks to the server. The outbox is the only place a message waits, and each item keeps its
 * id, so a retry on a later sync never adds a second line.
 */
object ExtendedFamily {
    private const val PREFS = "plainphone_extended"
    /** The text of a snapshot line. The server stores a placeholder, and the phone never shows it. */
    private const val SNAPSHOT_TEXT = "Location"
    private const val MAX_TEXT = 60
    private const val NOTIFICATION_BASE = 4000

    private val _changes = MutableStateFlow(0)
    /** Bumped when the roster, a conversation or the outbox changes, so an open screen reloads. */
    val changes: StateFlow<Int> = _changes.asStateFlow()

    private fun prefs(context: Context) = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun childRules(context: Context): ServerRules? =
        SyncStore(context).rules()?.takeIf { it.profile == "child" && !it.release }

    /** The rules' `extended` block on a child phone; off otherwise. */
    fun rules(context: Context): ExtendedRules = childRules(context)?.extended ?: ExtendedRules.OFF

    fun snapshotRules(context: Context): SnapshotRules = childRules(context)?.locationSnapshot ?: SnapshotRules.OFF

    // ---- Roster and the change list

    /** The people the child sees: the rules' roster with the child's own yes, no and block on top. */
    fun roster(context: Context): List<ExtendedContact> =
        LocalActions.effective(rules(context).contacts, actions(context))

    fun contact(context: Context, id: String): ExtendedContact? = roster(context).firstOrNull { it.id == id }

    fun changeLog(context: Context): List<ChangeLine> = readList(context, "log", ChangeLine::parse)

    private fun known(context: Context) = readList(context, "known", KnownContact::parse)
    private fun actions(context: Context) = readList(context, "actions", LocalAction::parse)
    private fun outbox(context: Context) = readList(context, "outbox", OutboxItem::parse)

    private fun <T> readList(context: Context, key: String, parse: (JSONObject) -> T?): List<T> = runCatching {
        JSONArray(prefs(context).getString(key, "[]")).mapObjects(parse)
    }.getOrDefault(emptyList())

    private fun writeList(context: Context, key: String, list: List<JSONObject>) {
        prefs(context).edit().putString(key, JSONArray(list).toString()).apply()
    }

    /** Diffs the roster against the one the phone saw last and writes the lines. Removed people lose their conversation. */
    @Synchronized
    internal fun recompute(context: Context, contacts: List<ExtendedContact>, nowMs: Long) {
        val kept = LocalActions.prune(actions(context), contacts, nowMs)
        writeList(context, "actions", kept.map { it.toJson() })
        val result = RosterDiff.diff(known(context), LocalActions.effective(contacts, kept), changeLog(context), nowMs)
        writeList(context, "known", result.known.map { it.toJson() })
        writeList(context, "log", result.log.map { it.toJson() })
        result.removedIds.forEach { forget(context, it) }
        _changes.value++
    }

    /** A person is gone from the roster: delete the cached conversation, what was waiting to go to them and the receipt list. */
    private fun forget(context: Context, id: String) {
        val e = prefs(context).edit().remove("conv.$id").remove("rev.$id").remove("received.$id")
        e.apply()
        writeList(context, "outbox", outbox(context).filter { it.target != id }.map { it.toJson() })
        cancelNotification(context, id)
    }

    // ---- The child's answers

    /** "Yes" or "No thanks" to an invitation. Shows at once; the server hears it now or on a later sync. */
    fun answer(context: Context, contactId: String, allow: Boolean, nowMs: Long = System.currentTimeMillis()) =
        choose(context, contactId, if (allow) LocalActionKind.YES else LocalActionKind.NO, nowMs)

    /** Blocks a person. Works while the feature is paused too. */
    fun block(context: Context, contactId: String, nowMs: Long = System.currentTimeMillis()) =
        choose(context, contactId, LocalActionKind.BLOCK, nowMs)

    @Synchronized
    private fun choose(context: Context, contactId: String, kind: LocalActionKind, nowMs: Long) {
        val c = rules(context).contacts.firstOrNull { it.id == contactId } ?: return
        writeList(context, "actions", (actions(context) + LocalAction(contactId, kind, c.status, nowMs)).map { it.toJson() })
        recompute(context, rules(context).contacts, nowMs)
    }

    /** Tells the server what the child chose. An answer the server cannot take (gone, not waiting) is done too: the rules say what is true. */
    fun sendActions(context: Context, api: PlainphoneApi, token: String) {
        val pending = actions(context).filter { !it.sent }
        for (a in pending) {
            try {
                if (a.kind == LocalActionKind.BLOCK) api.extendedBlock(token, a.contactId)
                else api.extendedAnswer(token, a.contactId, a.kind == LocalActionKind.YES)
            } catch (_: IOException) {
                return
            }
            synchronized(this) {
                writeList(context, "actions", actions(context).map { if (it == a) it.copy(sent = true) else it }.map { it.toJson() })
            }
        }
    }

    // ---- Conversations

    private fun cached(context: Context, id: String): List<ExtendedLine> = runCatching {
        JSONObject(prefs(context).getString("conv.$id", null) ?: return emptyList()).getJSONArray("lines").mapObjects(ExtendedLine::parse)
    }.getOrDefault(emptyList())

    /** The conversation with one person, oldest first: the server's copy and what this phone still holds. */
    fun lines(context: Context, contactId: String, nowMs: Long = System.currentTimeMillis()): List<ConversationLine> =
        ConversationMerge.merge(cached(context, contactId), outbox(context), contactId, nowMs)

    /** Quick messages to a person: the approved list, without code words (they are for SOS) and within 60 characters. */
    fun quickOffer(context: Context): List<QuickMessage> {
        if (!rules(context).quickMessages) return emptyList()
        val quick = SilentSos.childSos(SyncStore(context).rules())?.quickMessages ?: QuickMessages.NONE
        return if (quick.enabled) quick.items.filter { !it.meansSos && it.text.length <= MAX_TEXT } else emptyList()
    }

    /** The mode that keeps the child from writing to a person of [group] right now, as its name; null when nothing does. */
    fun blockedByMode(context: Context, group: String, nowMs: Long = System.currentTimeMillis()): String? {
        val mode = ExtendedModes.blockedBy(
            SyncStore(context).rules(), ContactPolicySources.get(context).rules().enforced, group,
            java.time.Instant.ofEpochMilli(nowMs),
        ) ?: return null
        return modeLabel(context, mode.mode)
    }

    /** Queues a quick message to an active person. False when it cannot go (not active, too long). */
    fun send(context: Context, contactId: String, message: QuickMessage, nowMs: Long = System.currentTimeMillis()): Boolean {
        val c = contact(context, contactId)
        if (c?.status != ContactStatus.ACTIVE || message.meansSos || message.text.length > MAX_TEXT) return false
        enqueue(context, OutboxItem(UUID.randomUUID().toString(), contactId, "quick", message.text, nowMs))
        return true
    }

    @Synchronized
    private fun enqueue(context: Context, item: OutboxItem) {
        writeList(context, "outbox", Outbox.prune(outbox(context) + item, emptySet(), item.sentAtMs).map { it.toJson() })
        _changes.value++
    }

    /** Tries everything waiting once, now. Blocking: call from a background thread. */
    fun flushNow(context: Context) {
        val sync = SyncStore(context)
        val token = sync.deviceToken() ?: return
        val api = org.plainphone.app.sos.SosDelivery.api(context)
        runCatching { sendActions(context, api, token) }
        flush(context, api, token, System.currentTimeMillis())
    }

    private fun flush(context: Context, api: PlainphoneApi, token: String, nowMs: Long) {
        val on = rules(context).enabled
        // Snapshots always go: the phone is the authority for what it did. Messages wait while the feature is off.
        val eligible = outbox(context).filter { it.kind == "snapshot" || on }
        if (eligible.none { it.status == OutboxStatus.PENDING }) return
        val done = Outbox.flush(eligible, nowMs) { attempt(api, token, it) }
        synchronized(this) {
            val byId = done.associateBy { it.id }
            val merged = outbox(context).map { cur -> if (cur.status == OutboxStatus.PENDING) byId[cur.id] ?: cur else cur }
            writeList(context, "outbox", merged.map { it.toJson() })
            _changes.value++
        }
    }

    private fun attempt(api: PlainphoneApi, token: String, item: OutboxItem): Attempt = try {
        val answer: ExtendedSendAnswer = if (item.kind == "snapshot") {
            api.sendLocationSnapshot(token, item.id, item.target, item.fix ?: return Attempt.REJECTED, item.sentAtMs)
        } else {
            api.extendedSend(token, item.target, item.id, item.text, item.sentAtMs)
        }
        when {
            answer.gone -> Attempt.GONE
            answer.stored -> Attempt.STORED
            else -> Attempt.RETRY
        }
    } catch (e: HttpError) {
        when {
            e.status == 404 -> Attempt.GONE
            e.status >= 500 || e.status in setOf(401, 408, 429) -> Attempt.RETRY
            else -> Attempt.REJECTED
        }
    } catch (_: IOException) {
        Attempt.RETRY
    }

    // ---- Location snapshots

    /**
     * Queues a snapshot the child confirmed, with the one position that was looked up, and adds the
     * line to the phone's own location log. [names] are who sees it (empty: the parents).
     */
    fun queueSnapshot(context: Context, target: ShareTarget, fix: LocationFix, names: List<String>, nowMs: Long = System.currentTimeMillis()) {
        val minutes = snapshotRules(context).minutes
        enqueue(context, OutboxItem(UUID.randomUUID().toString(), target.wire, "snapshot", SNAPSHOT_TEXT, nowMs, fix = fix))
        synchronized(this) {
            val entry = SnapshotLogEntry(names.joinToString(", "), nowMs, nowMs + minutes * 60_000L)
            writeList(context, "snaplog", SnapshotLogEntry.add(snapshotLog(context), entry, nowMs).map { it.toJson() })
        }
    }

    /** Every snapshot this phone shared in the last 30 days, newest first (only on the phone). */
    fun snapshotLog(context: Context, nowMs: Long = System.currentTimeMillis()): List<SnapshotLogEntry> =
        readList(context, "snaplog", { SnapshotLogEntry.parse(it) }).filter { nowMs - it.atMs < SnapshotLogEntry.KEEP_MS }

    /** Snapshots to the parents that the family thread does not hold yet, as lines for it. */
    fun parentSnapshotEntries(context: Context, serverIds: Set<String>, nowMs: Long = System.currentTimeMillis()): List<InboxEntry> =
        outbox(context).filter { it.kind == "snapshot" && it.target == "parents" && it.id !in serverIds }.map {
            val state = when (it.status) {
                OutboxStatus.STORED -> SendState.SENT
                OutboxStatus.FAILED -> SendState.FAILED
                OutboxStatus.PENDING -> if (Outbox.expired(it, nowMs)) SendState.FAILED else SendState.SENDING
            }
            InboxEntry(it.id, true, it.text, it.sentAtMs, "snapshot", state)
        }

    // ---- From the sync

    /**
     * From the sync: write the roster's change lines, send what the child chose and what is waiting,
     * fetch each conversation whose `rev` changed, send the device receipt and tell the child about
     * a new reply (quiet at bedtime).
     */
    fun refresh(context: Context, api: PlainphoneApi, token: String, rules: ServerRules, nowMs: Long = System.currentTimeMillis()) {
        if (rules.profile != "child" || rules.release) return
        val ext = rules.extended
        if (ext.enabled) {
            recompute(context, ext.contacts, nowMs)
            runCatching { sendActions(context, api, token) }
        }
        try {
            flush(context, api, token, nowMs)
        } finally {
            if (ext.enabled) {
                val p = prefs(context)
                for (c in roster(context).filter { it.status == ContactStatus.ACTIVE }) {
                    if (p.getInt("rev.${c.id}", -1) == c.rev && p.contains("conv.${c.id}")) continue
                    fetch(context, api, token, c)
                }
            }
        }
    }

    private fun fetch(context: Context, api: PlainphoneApi, token: String, c: ExtendedContact) {
        val thread = api.extendedThread(token, c.id)
        if (thread == null) {
            forget(context, c.id)
            _changes.value++
            return
        }
        val p = prefs(context)
        val seen = p.getStringSet("received.${c.id}", emptySet()).orEmpty()
        val replies = thread.lines.filter { !it.fromChild }
        val fresh = replies.filter { it.id !in seen }
        api.extendedReceived(token, c.id, fresh.map { it.id })
        val firstFetch = !p.contains("conv.${c.id}")
        val json = JSONObject().put("name", thread.name).put("lines", JSONArray(thread.lines.map { it.toJson() }))
        p.edit().putString("conv.${c.id}", json.toString()).putInt("rev.${c.id}", c.rev)
            .putStringSet("received.${c.id}", replies.map { it.id }.toSet()).apply()
        synchronized(this) {
            val onServer = thread.lines.map { it.id }.toSet()
            writeList(context, "outbox", Outbox.prune(outbox(context), onServer, System.currentTimeMillis()).map { it.toJson() })
        }
        _changes.value++
        // The first fetch is old news, not a new message.
        if (!firstFetch) fresh.lastOrNull { it.kind == "reply" }?.let { notify(context, c, it) }
    }

    private fun notificationId(contactId: String) = NOTIFICATION_BASE + (contactId.hashCode() and 0xff)

    private fun notify(context: Context, c: ExtendedContact, reply: ExtendedLine) {
        CallNotifications.createChannels(context)
        val quiet = ContactPolicySources.get(context).rules().silentBedtime
        val open = PendingIntent.getActivity(
            context, notificationId(c.id), PhoneActivity.extendedIntent(context, c.id),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = Notification.Builder(context, if (quiet) CallNotifications.CHANNEL_QUIET else CallNotifications.CHANNEL_MESSAGES)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(context.getString(R.string.ext_notification_from, c.name))
            .setContentText(reply.text)
            .setCategory(Notification.CATEGORY_MESSAGE)
            .setContentIntent(open)
            .setAutoCancel(true)
            .build()
        runCatching { context.getSystemService(NotificationManager::class.java).notify(notificationId(c.id), n) }
    }

    fun cancelNotification(context: Context, contactId: String) {
        runCatching { context.getSystemService(NotificationManager::class.java).cancel(notificationId(contactId)) }
    }
}
