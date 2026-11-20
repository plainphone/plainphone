// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.ContentResolver
import android.content.Context
import android.database.Cursor
import android.net.Uri
import android.provider.Telephony
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.PhoneNumbers

internal val smsHistoryOrder = compareByDescending<SmsMessage> { it.atMs }.thenByDescending { it.id }

internal fun mergeSmsHistory(loaded: List<SmsMessage>, incoming: List<SmsMessage>): List<SmsMessage> =
    (incoming + loaded).distinctBy { it.id }.sortedWith(smsHistoryOrder)

internal fun ContentResolver.queryHistoryPage(
    uri: Uri, columns: Array<String>, where: String, args: Array<String>?, order: String, size: Int,
): Cursor? = try {
    query(uri, columns, where, args, "$order LIMIT $size")
} catch (_: IllegalArgumentException) {
    // Restricted telephony providers can reject LIMIT in the sort order outright.
    null
} ?: query(uri, columns, where, args, order)

internal data class ThreadCursor(val date: Long, val seenAtDate: Set<Long>)
internal data class ThreadPage(
    val threads: Map<SmsThread, List<SmsMessage>>,
    val next: ThreadCursor?,
)

internal class SmsHistory(
    private val context: Context,
    private val rules: ContactRules = ContactPolicySources.get(context).rules(),
    private val nowMs: () -> Long = System::currentTimeMillis,
) {
    private val resolver = context.contentResolver

    fun threads(after: ThreadCursor?, size: Int): ThreadPage {
        val selection = "(message_count > 0 OR snippet IS NOT NULL OR has_attachment = 1)" +
            after?.let {
                " AND (date < ${it.date} OR (date = ${it.date} AND _id NOT IN (${it.seenAtDate.joinToString()})))"
            }.orEmpty()
        val columns = arrayOf("_id", "date", "recipient_ids", "read", "snippet")
        val order = "date DESC, _id ASC"
        // AOSP's simple conversation endpoint ignores sortOrder, including LIMIT.
        val bounded = "_id IN (SELECT _id FROM threads WHERE $selection ORDER BY $order LIMIT ${size + 1})"
        fun read(cursor: Cursor) = page(cursor, size + 1) {
            ConversationRow(cursor.getLong(0), cursor.getLong(1), cursor.getString(2).orEmpty(), cursor.getInt(3) != 0, cursor.getString(4))
        }.sortedWith(compareByDescending<ConversationRow> { it.date }.thenBy { it.id })
        val rows = resolver.query(conversations, columns, bounded, null, null)
            ?.use(::read)
            // AOSP rejects subqueries in the restricted view and simple=true has no limit argument.
            ?: windowed(columns, selection, after?.date, size, ::read)
        val visible = rows.take(size)
        val next = if (rows.size > size) {
            val date = visible.last().date
            val ids = visible.filter { it.date == date }.map { it.id }.toSet()
            ThreadCursor(date, ids + after?.takeIf { it.date == date }?.seenAtDate.orEmpty())
        } else null
        val recipients = addresses(visible.flatMap { row -> row.recipientIds.split(' ').mapNotNull(String::toLongOrNull) }.toSet())
        val previews = visible.flatMap { row ->
            val ids = row.recipientIds.split(' ').mapNotNull(String::toLongOrNull)
            val numbers = ids.mapNotNull(recipients::get)
                .map { PhoneNumbers.normalize(it, rules.country) ?: it }
            val number = if (ids.size == 1) numbers.singleOrNull() ?: smsAddress(row.id) else null
            if (number != null) {
                val partitions = SmsStore.partitions(context, row.id, number, rules)
                if (partitions.size > 1) {
                    partitions.keys.mapNotNull { kind ->
                        val thread = SmsThread(number, kind, row.id)
                        messages(thread, null, 1, includeBodies = false).firstOrNull()?.let { thread to it }
                    }
                } else listOf(SmsThread(number, systemId = row.id) to row.preview(number))
            } else {
                listOf(SmsThread("", SmsThreadKind.MMS, row.id, numbers) to row.preview(""))
            }
        }
        return ThreadPage(previews.sortedByDescending { it.second.atMs }.associate { it.first to listOf(it.second) }, next)
    }

    fun messages(
        thread: SmsThread, after: SmsMessage?, size: Int, includeBodies: Boolean = true,
    ): List<SmsMessage> {
        val id = thread.systemId ?: Telephony.Threads.getOrCreateThreadId(context, thread.number)
        val partition = if (thread.kind == SmsThreadKind.MMS) "1" else
            SmsStore.partitions(context, id, thread.number, rules)[thread.kind] ?: return emptyList()
        val smsColumns = arrayOf("_id", "address", "date", "type", "read")
        val sms = queryPage(
            Telephony.Sms.CONTENT_URI, if (includeBodies) smsColumns + "body" else smsColumns,
            "thread_id = $id AND ($partition)" + (after?.let {
                " AND (date < ${it.atMs} OR (date = ${it.atMs} AND _id < ${it.id}))"
            } ?: ""), "date DESC, _id DESC", size,
        ) { cursor ->
            page(cursor, size) {
                val type = cursor.getInt(3)
                SmsMessage(
                    cursor.getLong(0), cursor.getString(1).orEmpty(),
                    if (includeBodies) cursor.getString(5).orEmpty() else "", cursor.getLong(2),
                    type != Telephony.Sms.MESSAGE_TYPE_INBOX, type == Telephony.Sms.MESSAGE_TYPE_FAILED,
                    cursor.getInt(4) != 0,
                    pending = type == Telephony.Sms.MESSAGE_TYPE_OUTBOX || type == Telephony.Sms.MESSAGE_TYPE_QUEUED,
                )
            }
        }
        val mms = if (thread.kind == SmsThreadKind.CONTACT || thread.kind == SmsThreadKind.MMS) {
            mms(id, thread.number, after, size)
        } else emptyList()
        return (sms + mms).sortedWith(smsHistoryOrder).take(size)
    }

    private fun mms(id: Long, number: String, after: SmsMessage?, size: Int): List<SmsMessage> {
        val before = after?.let {
            val seconds = it.atMs / 1000
            if (it.atMs % 1000 != 0L || it.id > 0) " AND date <= $seconds"
            else " AND (date < $seconds OR (date = $seconds AND _id > ${-it.id}))"
        }.orEmpty()
        return queryPage(
            Telephony.Mms.CONTENT_URI, arrayOf("_id", "date", "msg_box"),
            "thread_id = $id$before", "date DESC, _id ASC", size,
        ) { cursor ->
            page(cursor, size) {
                val box = cursor.getInt(2)
                SmsMessage(
                    -cursor.getLong(0), number, "", cursor.getLong(1) * 1000,
                    box != Telephony.Mms.MESSAGE_BOX_INBOX, box == Telephony.Mms.MESSAGE_BOX_FAILED, true,
                )
            }
        }
    }

    private fun smsAddress(id: Long): String? = queryPage(
        Telephony.Sms.CONTENT_URI, arrayOf("address"),
        "thread_id = $id AND trim(address) <> ''", "date DESC, _id DESC", 1,
    ) { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0)?.let { PhoneNumbers.normalize(it, rules.country) ?: it }
        else null
    }

    private fun addresses(ids: Set<Long>): Map<Long, String> {
        if (ids.isEmpty()) return emptyMap()
        return query(canonicalAddresses, arrayOf("_id", "address"), "_id IN (${ids.joinToString()})") {
            buildMap {
                while (it.moveToNext()) it.getString(1)?.let { address -> put(it.getLong(0), address) }
            }
        }
    }

    private fun <T> query(
        uri: Uri, columns: Array<String>, where: String, read: (Cursor) -> T,
    ): T = checkNotNull(resolver.query(uri, columns, where, null, null)) { "No history cursor" }.use(read)

    /**
     * The provider materialises every matching conversation (simple=true ignores LIMIT), so on a
     * phone with thousands of them the first page would wait for all. Ask for a recent window first
     * and widen it only while it holds fewer than a page; the newest rows are the same either way.
     */
    private fun <T : Any> windowed(
        columns: Array<String>, selection: String, olderThan: Long?, size: Int, read: (Cursor) -> List<T>,
    ): List<T> {
        val top = olderThan ?: nowMs()
        var span = FIRST_WINDOW_MS
        while (span <= MAX_WINDOW_MS && top - span > 0) {
            val rows = query(conversations, columns, "$selection AND date >= ${top - span}", read)
            if (rows.size > size) return rows
            span *= WINDOW_GROWTH
        }
        return query(conversations, columns, selection, read)
    }

    private fun <T> queryPage(
        uri: Uri, columns: Array<String>, where: String, order: String, size: Int, read: (Cursor) -> T,
    ): T = checkNotNull(resolver.queryHistoryPage(uri, columns, where, null, order, size)) {
        "No history cursor"
    }.use(read)

    private fun <T> page(cursor: Cursor, size: Int, row: () -> T): List<T> = buildList {
        while (this.size < size && cursor.moveToNext()) add(row())
    }

    /** [snippet] is the provider's preview of the newest message; the conversation list shows it. */
    private data class ConversationRow(val id: Long, val date: Long, val recipientIds: String, val read: Boolean, val snippet: String?) {
        fun preview(number: String) = SmsMessage(0, number, snippet.orEmpty(), date, outgoing = false, failed = false, read = read)
    }

    private companion object {
        const val FIRST_WINDOW_MS = 30L * 24 * 60 * 60 * 1000
        const val WINDOW_GROWTH = 4
        const val MAX_WINDOW_MS = 4 * 365L * 24 * 60 * 60 * 1000
        val conversations: Uri = Uri.parse("content://mms-sms/conversations?simple=true")
        val canonicalAddresses: Uri = Uri.parse("content://mms-sms/canonical-addresses")
    }
}
