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

    // The combined provider supplies one row per system conversation. AOSP sorts
    // simple queries by date regardless of sortOrder, so retain IDs at the boundary
    // timestamp to prevent skipping conversations with the same date.
    fun threads(after: ThreadCursor?, size: Int): ThreadPage {
        val rows = query(
            conversations, arrayOf("_id", "date", "recipient_ids", "read"),
            "(message_count > 0 OR snippet IS NOT NULL OR has_attachment = 1)" +
                after?.let { " AND date <= ${it.date}" }.orEmpty(), "date DESC",
        ) {
            buildList {
                while (this.size <= size && it.moveToNext()) {
                    val id = it.getLong(0)
                    val date = it.getLong(1)
                    if (after != null && date == after.date && id in after.seenAtDate) continue
                    add(ConversationRow(id, date, it.getString(2).orEmpty(), it.getInt(3) != 0))
                }
            }
        }
        val visible = rows.take(size)
        val next = if (rows.size > size) {
            val date = visible.last().date
            val ids = visible.filter { it.date == date }.map { it.id }.toSet()
            ThreadCursor(date, ids + after?.takeIf { it.date == date }?.seenAtDate.orEmpty())
        } else null
        val recipients = addresses(visible.flatMap { row -> row.recipientIds.split(' ').mapNotNull(String::toLongOrNull) }.toSet())
        val previews = visible.flatMap { row ->
            val numbers = row.recipientIds.split(' ').mapNotNull { recipients[it.toLongOrNull()] }
                .map { PhoneNumbers.normalize(it, rules.country) ?: it }
            if (numbers.size == 1 && row.recipientIds.trim().split(' ').size == 1) {
                val number = numbers.single()
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
            } ?: ""), "date DESC, _id DESC",
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
        return (sms + mms).sortedWith(compareByDescending<SmsMessage> { it.atMs }.thenByDescending { it.id }).take(size)
    }

    private fun mms(id: Long, number: String, after: SmsMessage?, size: Int): List<SmsMessage> {
        val before = after?.let {
            val seconds = it.atMs / 1000
            if (it.atMs % 1000 != 0L || it.id > 0) " AND date <= $seconds"
            else " AND (date < $seconds OR (date = $seconds AND _id > ${-it.id}))"
        }.orEmpty()
        return query(
            Telephony.Mms.CONTENT_URI, arrayOf("_id", "date", "msg_box"),
            "thread_id = $id$before", "date DESC, _id ASC",
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
