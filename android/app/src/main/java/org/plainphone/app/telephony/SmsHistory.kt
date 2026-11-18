// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

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

internal data class ThreadCursor(val date: Long, val seenAtDate: Set<Long>)
internal data class ThreadPage(
    val threads: Map<SmsThread, List<SmsMessage>>,
    val next: ThreadCursor?,
)

internal class SmsHistory(
    private val context: Context,
    private val rules: ContactRules = ContactPolicySources.get(context).rules(),
) {
    private val resolver = context.contentResolver

    fun threads(after: ThreadCursor?, size: Int): ThreadPage {
        val selection = "(message_count > 0 OR snippet IS NOT NULL OR has_attachment = 1)" +
            after?.let {
                " AND (date < ${it.date} OR (date = ${it.date} AND _id NOT IN (${it.seenAtDate.joinToString()})))"
            }.orEmpty()
        val columns = arrayOf("_id", "date", "recipient_ids", "read")
        val order = "date DESC, _id ASC"
        // AOSP's simple conversation endpoint ignores sortOrder, including LIMIT.
        val bounded = "_id IN (SELECT _id FROM threads WHERE $selection ORDER BY $order LIMIT ${size + 1})"
        fun read(cursor: Cursor) = page(cursor, size + 1) {
            ConversationRow(cursor.getLong(0), cursor.getLong(1), cursor.getString(2).orEmpty(), cursor.getInt(3) != 0)
        }.sortedWith(compareByDescending<ConversationRow> { it.date }.thenBy { it.id })
        val rows = resolver.query(conversations, columns, bounded, null, "$order LIMIT ${size + 1}")
            ?.use(::read)
            // The restricted AOSP provider rejects subqueries when Plainphone lacks the SMS role.
            ?: query(conversations, columns, selection, "$order LIMIT ${size + 1}", ::read)
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
        val sms = query(
            Telephony.Sms.CONTENT_URI, if (includeBodies) smsColumns + "body" else smsColumns,
            "thread_id = $id AND ($partition)" + (after?.let {
                " AND (date < ${it.atMs} OR (date = ${it.atMs} AND _id < ${it.id}))"
            } ?: ""), "date DESC, _id DESC LIMIT $size",
        ) { cursor ->
            page(cursor, size) {
                val type = cursor.getInt(3)
                SmsMessage(
                    cursor.getLong(0), cursor.getString(1).orEmpty(),
                    if (includeBodies) cursor.getString(5).orEmpty() else "", cursor.getLong(2),
                    type != Telephony.Sms.MESSAGE_TYPE_INBOX, type == Telephony.Sms.MESSAGE_TYPE_FAILED,
                    cursor.getInt(4) != 0,
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
        return query(
            Telephony.Mms.CONTENT_URI, arrayOf("_id", "date", "msg_box"),
            "thread_id = $id$before", "date DESC, _id ASC LIMIT $size",
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

    private fun smsAddress(id: Long): String? = query(
        Telephony.Sms.CONTENT_URI, arrayOf("address"),
        "thread_id = $id AND trim(address) <> ''", "date DESC, _id DESC LIMIT 1",
    ) { cursor ->
        if (cursor.moveToFirst()) cursor.getString(0)?.let { PhoneNumbers.normalize(it, rules.country) ?: it }
        else null
    }

    private fun addresses(ids: Set<Long>): Map<Long, String> {
        if (ids.isEmpty()) return emptyMap()
        return query(canonicalAddresses, arrayOf("_id", "address"), "_id IN (${ids.joinToString()})", null) {
            buildMap {
                while (it.moveToNext()) it.getString(1)?.let { address -> put(it.getLong(0), address) }
            }
        }
    }

    private fun <T> query(
        uri: Uri, columns: Array<String>, where: String?, order: String?, read: (Cursor) -> T,
    ): T = checkNotNull(resolver.query(uri, columns, where, null, order)) { "No history cursor" }.use(read)

    private fun <T> page(cursor: Cursor, size: Int, row: () -> T): List<T> = buildList {
        while (this.size < size && cursor.moveToNext()) add(row())
    }

    private data class ConversationRow(val id: Long, val date: Long, val recipientIds: String, val read: Boolean) {
        fun preview(number: String) = SmsMessage(0, number, "", date, outgoing = false, failed = false, read = read)
    }

    private companion object {
        val conversations: Uri = Uri.parse("content://mms-sms/conversations?simple=true")
        val canonicalAddresses: Uri = Uri.parse("content://mms-sms/canonical-addresses")
    }
}
