// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.extended

import java.time.Instant
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.sync.ActiveMode
import org.plainphone.app.sync.ContactStatus
import org.plainphone.app.sync.ExtendedContact
import org.plainphone.app.sync.ExtendedLine
import org.plainphone.app.sync.LocationFix
import org.plainphone.app.sync.Modes
import org.plainphone.app.sync.ServerRules

/*
 * The pure parts of extended family contacts and location snapshots (docs/extended-family.md):
 * the roster's change list, what the child already answered, how a conversation and its outbox
 * merge into honest states, the mode gate and the snapshot confirmation. No Android, no clock of
 * their own: every function takes the time it needs, so the JVM tests pin it.
 */

/** What changed on the roster, as one line for the child. */
enum class ChangeKind { INVITED, JOINED, NEW_LINK, REMOVED, BLOCKED }

data class ChangeLine(val kind: ChangeKind, val name: String, val atMs: Long) {
    fun toJson(): JSONObject = JSONObject().put("kind", kind.name).put("name", name).put("at", atMs)

    companion object {
        fun parse(o: JSONObject): ChangeLine? {
            val kind = ChangeKind.entries.firstOrNull { it.name == o.optString("kind") } ?: return null
            return ChangeLine(kind, o.optString("name"), o.optLong("at"))
        }
    }
}

/** A person as the phone last saw the roster. [everActive] tells a new link from a first invitation. */
data class KnownContact(val id: String, val name: String, val status: ContactStatus, val everActive: Boolean) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("name", name).put("status", status.wire).put("everActive", everActive)

    companion object {
        fun parse(o: JSONObject): KnownContact? {
            val status = ContactStatus.fromWire(o.optString("status")) ?: return null
            return KnownContact(o.optString("id").ifEmpty { return null }, o.optString("name"), status, o.optBoolean("everActive"))
        }
    }
}

object RosterDiff {
    const val KEEP_LINES = 30
    const val KEEP_MS = 30L * 86_400_000

    data class Result(val known: List<KnownContact>, val log: List<ChangeLine>, val removedIds: List<String>)

    /**
     * Compares the roster the phone saw last ([previous]) with the roster now ([current]) and adds a
     * line per change to [log] (newest first; 30 lines and 30 days at most). Nobody disappears
     * without a line, also when the removal happened while the phone was offline. The first time
     * (nothing known) every person gets the line for where they stand.
     */
    fun diff(previous: List<KnownContact>, current: List<ExtendedContact>, log: List<ChangeLine>, nowMs: Long): Result {
        val before = previous.associateBy { it.id }
        val added = mutableListOf<ChangeLine>()
        val known = current.map { c ->
            val old = before[c.id]
            val ever = (old?.everActive ?: false) || c.status == ContactStatus.ACTIVE
            when {
                old == null -> when (c.status) {
                    ContactStatus.ACTIVE -> added += ChangeLine(ChangeKind.JOINED, c.name, nowMs)
                    ContactStatus.BLOCKED -> added += ChangeLine(ChangeKind.BLOCKED, c.name, nowMs)
                    else -> added += ChangeLine(ChangeKind.INVITED, c.name, nowMs)
                }
                old.status == c.status -> Unit
                c.status == ContactStatus.ACTIVE -> added += ChangeLine(ChangeKind.JOINED, c.name, nowMs)
                c.status == ContactStatus.BLOCKED -> added += ChangeLine(ChangeKind.BLOCKED, c.name, nowMs)
                // The parents made a new link: the child has to say yes again.
                c.status == ContactStatus.WAITING_FOR_CHILD -> added += ChangeLine(ChangeKind.NEW_LINK, c.name, nowMs)
                // Waiting for the person after the child said yes: the child's own action, no line.
                else -> Unit
            }
            KnownContact(c.id, c.name, c.status, ever)
        }
        val now = current.map { it.id }.toSet()
        val gone = previous.filter { it.id !in now }
        gone.forEach { added += ChangeLine(ChangeKind.REMOVED, it.name, nowMs) }
        val lines = (added.reversed() + log).filter { nowMs - it.atMs < KEEP_MS }.take(KEEP_LINES)
        return Result(known, lines, gone.map { it.id })
    }
}

/** What the child chose on the phone that the server may not know yet. */
enum class LocalActionKind { YES, NO, BLOCK }

data class LocalAction(
    val contactId: String,
    val kind: LocalActionKind,
    /** The state the person was in when the child chose; the choice shows while the rules still say so. */
    val fromStatus: ContactStatus,
    val atMs: Long,
    /** The server has been told. */
    val sent: Boolean = false,
) {
    fun toJson(): JSONObject = JSONObject().put("id", contactId).put("kind", kind.name).put("from", fromStatus.wire)
        .put("at", atMs).put("sent", sent)

    companion object {
        fun parse(o: JSONObject): LocalAction? {
            val kind = LocalActionKind.entries.firstOrNull { it.name == o.optString("kind") } ?: return null
            val from = ContactStatus.fromWire(o.optString("from")) ?: return null
            return LocalAction(o.optString("id").ifEmpty { return null }, kind, from, o.optLong("at"), o.optBoolean("sent"))
        }
    }
}

object LocalActions {
    const val KEEP_MS = 7L * 86_400_000

    /**
     * The roster with the child's own choices on top, so "Yes" and "Block" show at once and not when
     * the next sync comes. A choice shows only while the rules still hold the state it was made in.
     */
    fun effective(contacts: List<ExtendedContact>, actions: List<LocalAction>): List<ExtendedContact> =
        contacts.mapNotNull { c ->
            val a = actions.lastOrNull { it.contactId == c.id && it.fromStatus == c.status } ?: return@mapNotNull c
            when (a.kind) {
                LocalActionKind.YES -> c.copy(status = ContactStatus.WAITING_FOR_CONTACT)
                LocalActionKind.NO -> null
                LocalActionKind.BLOCK -> c.copy(status = ContactStatus.BLOCKED)
            }
        }

    /** Drops choices the rules have caught up with, and old ones. A choice not yet sent stays so it can be sent. */
    fun prune(actions: List<LocalAction>, contacts: List<ExtendedContact>, nowMs: Long): List<LocalAction> =
        actions.filter { a ->
            val c = contacts.firstOrNull { it.id == a.contactId }
            nowMs - a.atMs < KEEP_MS && !(a.sent && (c == null || c.status != a.fromStatus))
        }
}

/** Where a message to a person (or a snapshot) is. */
enum class LineState { SENDING, SENT, DELIVERED, NOT_DELIVERED }

enum class OutboxStatus { PENDING, STORED, FAILED }

/** A message or snapshot the child sent that may not be on the server yet. The id never changes, so a retry cannot add a second line. */
data class OutboxItem(
    val id: String,
    /** `parents` or a contact id. */
    val target: String,
    /** `quick` or `snapshot`. */
    val kind: String,
    val text: String,
    val sentAtMs: Long,
    val status: OutboxStatus = OutboxStatus.PENDING,
    /** Snapshots only, and only while pending: the one position that was looked up. */
    val fix: LocationFix? = null,
) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("target", target).put("kind", kind).put("text", text)
        .put("at", sentAtMs).put("status", status.name).apply {
            fix?.let { put("lat", it.lat).put("lon", it.lon).put("acc", it.accuracyM?.toDouble() ?: JSONObject.NULL).put("rec", it.recordedAtMs) }
        }

    companion object {
        fun parse(o: JSONObject): OutboxItem? {
            val status = OutboxStatus.entries.firstOrNull { it.name == o.optString("status") } ?: return null
            val fix = if (o.has("lat")) LocationFix(
                o.getDouble("lat"), o.getDouble("lon"),
                if (o.isNull("acc")) null else o.getDouble("acc").toFloat(), o.getLong("rec"),
            ) else null
            return OutboxItem(
                o.optString("id").ifEmpty { return null }, o.optString("target"), o.optString("kind", "quick"),
                o.optString("text"), o.optLong("at"), status, fix,
            )
        }
    }
}

/** What one attempt to send an [OutboxItem] came to. */
enum class Attempt {
    /** The server has it. */
    STORED,
    /** Nobody to keep it for: removed, blocked or never joined. */
    GONE,
    /** No network, or the server failed: try again with the same id. */
    RETRY,
    /** The server will never take it (a client error). */
    REJECTED,
}

object Outbox {
    /** A message is retried for a day (docs/extended-family.md), then it is "Not delivered". */
    const val GIVE_UP_MS = 86_400_000L
    /** A position older than the hour it may be seen for is not sent. */
    const val SNAPSHOT_GIVE_UP_MS = 3_600_000L
    const val KEEP = 40
    const val KEEP_MS = 30L * 86_400_000

    fun giveUpMs(kind: String) = if (kind == "snapshot") SNAPSHOT_GIVE_UP_MS else GIVE_UP_MS

    fun expired(item: OutboxItem, nowMs: Long) = nowMs - item.sentAtMs > giveUpMs(item.kind)

    /**
     * One pass over the outbox: every pending item is tried once, oldest first, with its own id.
     * What is retried stays pending and unchanged; after a day (an hour for a snapshot) it fails.
     * The first [Attempt.RETRY] ends the pass, as the network is probably gone.
     */
    fun flush(items: List<OutboxItem>, nowMs: Long, send: (OutboxItem) -> Attempt): List<OutboxItem> {
        var stop = false
        return items.map { item ->
            when {
                item.status != OutboxStatus.PENDING -> item
                expired(item, nowMs) -> item.copy(status = OutboxStatus.FAILED, fix = null)
                stop -> item
                else -> when (send(item)) {
                    Attempt.STORED -> item.copy(status = OutboxStatus.STORED, fix = null)
                    Attempt.GONE, Attempt.REJECTED -> item.copy(status = OutboxStatus.FAILED, fix = null)
                    Attempt.RETRY -> { stop = true; item }
                }
            }
        }
    }

    /** Keeps the newest [KEEP] from the last 30 days, and drops what the server's conversation already holds. */
    fun prune(items: List<OutboxItem>, onServer: Set<String>, nowMs: Long): List<OutboxItem> =
        items.filter { nowMs - it.sentAtMs < KEEP_MS && !(it.status == OutboxStatus.STORED && it.id in onServer) }.takeLast(KEEP)
}

/** One line of a conversation as the child sees it. */
data class ConversationLine(
    val key: String,
    val fromChild: Boolean,
    /** `quick`, `reply` or `snapshot`. */
    val kind: String,
    val text: String,
    val atMs: Long,
    /** Child lines only. */
    val state: LineState? = null,
)

object ConversationMerge {
    /**
     * The server's lines and what this phone still holds for [target], oldest first. The server wins
     * for a line it has: Delivered once the person's device got it, otherwise Sent. A line only on
     * the phone is Sending until the server has it, and Not delivered when the person is gone or
     * a day has passed.
     */
    fun merge(server: List<ExtendedLine>, outbox: List<OutboxItem>, target: String, nowMs: Long): List<ConversationLine> {
        val onServer = server.map { it.id }.toSet()
        val fromServer = server.map {
            ConversationLine(
                it.id, it.fromChild, it.kind, it.text, it.sentAtMs,
                if (it.fromChild) if (it.receivedAtMs != null) LineState.DELIVERED else LineState.SENT else null,
            )
        }
        val onlyHere = outbox.filter { it.target == target && it.id !in onServer }.map {
            val state = when (it.status) {
                OutboxStatus.STORED -> LineState.SENT
                OutboxStatus.FAILED -> LineState.NOT_DELIVERED
                OutboxStatus.PENDING -> if (Outbox.expired(it, nowMs)) LineState.NOT_DELIVERED else LineState.SENDING
            }
            ConversationLine(it.id, true, it.kind, it.text, it.sentAtMs, state)
        }
        return (fromServer + onlyHere).sortedBy { it.atMs }
    }
}

/** The mode gate: can the child write to a person of [group] in the mode on now? */
object ExtendedModes {
    /**
     * The mode that keeps the child from writing to a person of [group], or null when nothing does.
     * Groups only narrow when the approved list is enforced and a parent is marked (docs/modes.md),
     * which [Modes.shown] already tells; with no modes, no narrowing, or an unknown group (others)
     * the child can write.
     */
    fun blockedBy(rules: ServerRules?, contactsEnforced: Boolean, group: String, now: Instant): ActiveMode? {
        val mode = Modes.shown(rules, contactsEnforced, now) ?: return null
        val groups = mode.contactGroups ?: return null
        return if (group in groups) null else mode
    }
}

/** Who gets a snapshot: the parents, or one person. */
sealed interface ShareTarget {
    data object Parents : ShareTarget
    data class Person(val contactId: String, val name: String) : ShareTarget

    /** What the server calls it in `to`. */
    val wire: String get() = when (this) { is Parents -> "parents"; is Person -> contactId }
}

object SnapshotConfirm {
    /**
     * The names the confirmation shows: the family inbox's recipients for the parents (empty when the
     * phone does not know them yet, then the screen says "your parents"), or the person's name.
     */
    fun recipients(target: ShareTarget, parentNames: List<String>): List<String> = when (target) {
        is ShareTarget.Parents -> parentNames.filter { it.isNotBlank() }
        is ShareTarget.Person -> listOf(target.name)
    }

    /** `(hours, minutes)`: whole hours as hours, anything else in minutes. */
    fun duration(minutes: Int): Pair<Int, Boolean> = if (minutes % 60 == 0) minutes / 60 to true else minutes to false
}

/** What the lookup for a snapshot came to. Nothing is sent unless it is [Found]. */
sealed interface LookupOutcome {
    data class Found(val fix: LocationFix) : LookupOutcome
    /** The permission is missing or location is off in the system settings. */
    data object Off : LookupOutcome
    /** Location is on, but no position came within the budget. */
    data object NoFix : LookupOutcome

    companion object {
        fun of(permissionGranted: Boolean, locationEnabled: Boolean, fix: LocationFix?): LookupOutcome = when {
            !permissionGranted || !locationEnabled -> Off
            fix == null -> NoFix
            else -> Found(fix)
        }
    }
}

/** One line of "What can my parents see?": the child shared where they are. [names] empty means the parents. */
data class SnapshotLogEntry(val names: String, val atMs: Long, val untilMs: Long) {
    fun toJson(): JSONObject = JSONObject().put("names", names).put("at", atMs).put("until", untilMs)

    companion object {
        const val KEEP_MS = 30L * 86_400_000
        const val KEEP = 50

        fun parse(o: JSONObject) = SnapshotLogEntry(o.optString("names"), o.optLong("at"), o.optLong("until"))

        /** Adds [entry] (newest first) and drops what is older than 30 days. */
        fun add(log: List<SnapshotLogEntry>, entry: SnapshotLogEntry, nowMs: Long): List<SnapshotLogEntry> =
            (listOf(entry) + log).filter { nowMs - it.atMs < KEEP_MS }.take(KEEP)
    }
}

internal fun <T> JSONArray.mapObjects(f: (JSONObject) -> T?): List<T> = (0 until length()).mapNotNull { f(getJSONObject(it)) }
