// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.Cursor
import android.database.CursorWrapper
import android.database.MatrixCursor
import android.database.sqlite.SQLiteDatabase
import android.net.Uri
import android.provider.Telephony
import androidx.test.core.app.ApplicationProvider
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.HelpDirectory
import org.plainphone.app.contacts.Helpline
import org.plainphone.app.contacts.Inbound
import org.plainphone.app.contacts.PhoneNumbers
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SmsHistoryTest {
    private lateinit var provider: HistoryProvider
    private val context get() = ApplicationProvider.getApplicationContext<Context>()

    @Before
    fun setUp() {
        provider = HistoryProvider()
        for (authority in listOf("sms", "mms", "mms-sms")) {
            ShadowContentResolver.registerProviderInternal(authority, provider)
        }
    }

    @After
    fun close() = provider.db.close()

    @Test
    fun pagesConversationsWithoutReadingThousandsOfSmsAndKeepsBoundaryTies() {
        val newest = SmsStore.threadPage(context, null, 1)
        val first = newest.threads.keys.single()
        assertEquals("12345678", first.number)
        assertNotNull(newest.next)
        assertEquals(2, provider.threadRows)
        assertEquals(0, provider.smsRows)

        val older = SmsStore.threadPage(context, newest.next, 1)
        assertEquals("87654321", older.threads.keys.single().number)
        assertNull(older.next)
        assertEquals(0, provider.smsRows)

        val page = SmsStore.messagePage(context, first, null, 50)
        assertEquals(50, provider.smsRows)
        assertEquals(5001L, page.first().id)
        assertEquals("message 5001", page.first().body)
        val next = SmsStore.messagePage(context, first, page.last(), 50)
        assertEquals(100, provider.smsRows)
        assertEquals(4951L, next.first().id)
        assertEquals(emptySet<Long>(), page.map { it.id }.toSet().intersect(next.map { it.id }.toSet()))
    }

    @Test
    fun limitsRowsInsideTheProvider() {
        val thread = SmsStore.threadPage(context, null, 1).threads.keys.single()
        // Both populated threads tie on date. More matching threads must stay outside the cursor.
        provider.db.execSQL("INSERT INTO threads VALUES (10, 4000, '1', 1, 1, NULL, 0)")
        SmsStore.threadPage(context, null, 1)
        assertEquals(2, provider.threadCount)
        SmsStore.messagePage(context, thread, null, 50)
        assertEquals(50, provider.smsCount)
    }

    @Test
    fun missingCanonicalAddressKeepsSingleRecipientSmsThread() {
        provider.db.execSQL("DELETE FROM addresses WHERE _id = 1")
        val thread = SmsStore.threadPage(context, null, 1).threads.keys.single()
        assertEquals(SmsThread("12345678", systemId = 7), thread)
        assertEquals(5001L, SmsStore.messagePage(context, thread, null, 1).single().id)
    }

    @Test
    fun restrictedProviderKeepsSmsAndMmsReadableWithoutCanonicalAddress() {
        provider.restricted = true
        provider.db.execSQL("DELETE FROM addresses WHERE _id = 1")
        provider.db.execSQL("INSERT INTO mms VALUES (1, 7, 6, 1)")
        val first = SmsStore.threadPage(context, null, 1)
        val thread = first.threads.keys.single()
        assertEquals(SmsThread("12345678", systemId = 7), thread)
        val messages = SmsStore.messagePage(context, thread, null, 2)
        assertEquals(listOf(-1L, 5001L), messages.map { it.id })
        assertEquals(5000L, SmsStore.messagePage(context, thread, messages.last(), 1).single().id)
        val second = SmsStore.threadPage(context, first.next, 1)
        assertEquals("87654321", second.threads.keys.single().number)
        assertNull(second.next)
    }

    @Test
    fun mergesSmsAndMmsFromTheSameSystemConversationAcrossTimestampTies() {
        provider.db.execSQL("UPDATE threads SET date = 5000 WHERE _id = 7")
        provider.db.execSQL("INSERT INTO mms VALUES (1, 7, 5, 1), (2, 7, 5, 1)")
        val thread = SmsStore.threadPage(context, null, 10).threads.keys.single { it.systemId == 7L }
        val first = SmsStore.messagePage(context, thread, null, 2)
        assertEquals(listOf(5001L, 5000L), first.map { it.id })
        val second = SmsStore.messagePage(context, thread, first.last(), 1)
        assertEquals(-1L, second.single().id)
        assertEquals("12345678", second.single().number)
        val third = SmsStore.messagePage(context, thread, second.last(), 2)
        assertEquals(listOf(-2L, 4999L), third.map { it.id })
    }

    @Test
    fun mergingARefreshRetainsOlderPagesAndUpdatesExistingMessages() {
        val thread = SmsStore.threadPage(context, null, 1).threads.keys.single()
        val first = SmsStore.messagePage(context, thread, null, 2)
        val older = SmsStore.messagePage(context, thread, first.last(), 2)
        val updated = first.first().copy(read = true)
        val incoming = updated.copy(id = 5002, atMs = 5002)
        val merged = mergeSmsHistory(first + older, listOf(incoming, updated))
        assertEquals(listOf(5002L, 5001L, 5000L, 4999L, 4998L), merged.map { it.id })
        assertEquals(updated, merged[1])
    }

    @Test
    fun bodyFailureFailsThePageAndRetryReturnsUnreadText() {
        val thread = SmsStore.threadPage(context, null, 1).threads.keys.single()
        provider.failBody = true
        assertThrows(IllegalStateException::class.java) { SmsStore.messagePage(context, thread, null, 1) }
        assertEquals(0, provider.updates)
        provider.failBody = false
        val message = SmsStore.messagePage(context, thread, null, 1).single()
        assertEquals("message 5001", message.body)
        assertFalse(message.read)
        val changes = SmsStore.changes.value
        SmsStore.markRead(context, listOf(message))
        assertEquals(1, provider.updates)
        assertEquals(changes, SmsStore.changes.value)
    }

    @Test
    fun opensProviderThreadForDirectRoutesAndResolvesNewConversation() {
        assertEquals(5001L, SmsStore.messagePage(context, SmsThread("12345678"), null, 1).single().id)
        assertEquals(emptyList<SmsMessage>(), SmsStore.messagePage(context, SmsThread("22223333"), null, 50))
    }

    @Test
    fun separatesUnverifiedHistoryFromHelplineRepliesEvenInOneSystemThread() {
        provider.db.execSQL("INSERT INTO threads VALUES (10, 103, '3', 0, 4, NULL, 0)")
        provider.db.execSQL("INSERT INTO addresses VALUES (3, '116111')")
        provider.db.execSQL("""
            INSERT INTO sms VALUES
                (7100, 10, '116111', 100, 2, 1, 'old send'),
                (7101, 10, '116111', 101, 1, 0, 'old unverified reply'),
                (7102, 10, '116111', 102, 1, 0, 'new verified reply'),
                (7103, 10, '116111', 103, 1, 0, 'new unverified message')
        """.trimIndent())
        context.getSharedPreferences("plainphone_sms", Context.MODE_PRIVATE).edit()
            .putLong("legacy_through", 7101)
            .putStringSet("help_reply_ids", setOf("7102"))
            .apply()
        val number = "116111"
        val rules = ContactRules(
            true, emptyList(), PhoneNumbers.countryForIso("DK"),
            HelpDirectory(lines = listOf(Helpline("BørneTelefonen", null, number, null, smsInbound = Inbound.REPLY_ONLY))),
        )
        val store = SmsHistory(context, rules)
        val threads = store.threads(null, 10).threads.keys.filter { it.systemId == 10L }.associateBy { it.kind }
        assertEquals(setOf(SmsThreadKind.CONTACT, SmsThreadKind.HELP, SmsThreadKind.LEGACY), threads.keys)
        assertEquals("BørneTelefonen", threads.getValue(SmsThreadKind.HELP).contact(rules)?.name)
        assertEquals(listOf(7102L, 7100L), store.messages(threads.getValue(SmsThreadKind.HELP), null, 10).map { it.id })
        assertEquals(7101L, store.messages(threads.getValue(SmsThreadKind.LEGACY), null, 10).single().id)
        assertEquals(7103L, store.messages(threads.getValue(SmsThreadKind.CONTACT), null, 10).single().id)

        val overlapping = rules.copy(contacts = listOf(ApprovedContact("Approved contact", number)))
        val approved = SmsHistory(context, overlapping)
        val approvedThreads = approved.threads(null, 10).threads.keys.filter { it.systemId == 10L }.associateBy { it.kind }
        assertEquals(setOf(SmsThreadKind.CONTACT, SmsThreadKind.HELP), approvedThreads.keys)
        assertEquals("Approved contact", approvedThreads.getValue(SmsThreadKind.CONTACT).contact(overlapping)?.name)
        assertEquals(listOf(7103L, 7101L), approved.messages(approvedThreads.getValue(SmsThreadKind.CONTACT), null, 10).map { it.id })
    }

    internal class HistoryProvider : ContentProvider() {
        var threadCount = 0
        var smsCount = 0
        var threadRows = 0
        var smsRows = 0
        var updates = 0
        var failBody = false
        var restricted = false

        val db = SQLiteDatabase.create(null).apply {
            execSQL("CREATE TABLE threads (_id INTEGER PRIMARY KEY, date INTEGER, recipient_ids TEXT, read INTEGER, message_count INTEGER, snippet TEXT, has_attachment INTEGER)")
            execSQL("INSERT INTO threads VALUES (7, 5001, '1', 0, 5000, NULL, 0), (8, 5001, '2', 1, 1, NULL, 0), (9, 6000, '3', 0, 0, NULL, 0)")
            execSQL("CREATE TABLE addresses (_id INTEGER PRIMARY KEY, address TEXT)")
            execSQL("INSERT INTO addresses VALUES (1, '12345678'), (2, '87654321')")
            execSQL("CREATE TABLE sms (_id INTEGER PRIMARY KEY, thread_id INTEGER, address TEXT, date INTEGER, type INTEGER, read INTEGER, body TEXT)")
            execSQL("INSERT INTO sms VALUES (1, 8, '87654321', 1, 1, 1, 'old thread')")
            execSQL("""
                WITH RECURSIVE ids(id) AS (VALUES(2) UNION ALL SELECT id + 1 FROM ids WHERE id < 5001)
                INSERT INTO sms SELECT id, 7, '12345678', id, 1, 0, 'message ' || id FROM ids
            """.trimIndent())
            execSQL("CREATE TABLE mms (_id INTEGER PRIMARY KEY, thread_id INTEGER, date INTEGER, msg_box INTEGER)")
        }

        override fun onCreate() = true
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?): Int {
            updates++
            return 1
        }

        override fun query(
            uri: Uri, projection: Array<out String>?, selection: String?,
            selectionArgs: Array<out String>?, sortOrder: String?,
        ): Cursor? {
            if (restricted && selection?.contains("SELECT") == true) return null
            if (restricted && sortOrder?.contains("LIMIT") == true) {
                if (uri.authority == "mms") return null
                if (uri.authority == "sms") throw IllegalArgumentException("Invalid token LIMIT")
            }
            if (uri.authority == "sms" && failBody && projection?.contains(Telephony.Sms.BODY) == true) {
                error("Could not read message body")
            }
            if (uri.lastPathSegment == "threadID") {
                val id = if (uri.getQueryParameter("recipient") == "12345678") 7 else 9
                return MatrixCursor(arrayOf("_id")).apply { addRow(arrayOf(id)) }
            }
            val table = when (uri.authority) {
                "sms", "mms" -> requireNotNull(uri.authority)
                else -> if (uri.lastPathSegment == "conversations") "threads" else "addresses"
            }
            val order = if (table == "threads") "date DESC" else sortOrder
            val cursor = db.query(table, projection, selection, selectionArgs, null, null, order)
            when (table) {
                "threads" -> threadCount = cursor.count
                "sms" -> smsCount = cursor.count
            }
            return object : CursorWrapper(cursor) {
                override fun moveToNext(): Boolean = super.moveToNext().also { moved ->
                    if (moved) when (table) {
                        "threads" -> threadRows++
                        "sms" -> smsRows++
                    }
                }
            }
        }
    }
}
