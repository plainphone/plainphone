// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.ContentProvider
import android.content.ContentValues
import android.content.Context
import android.database.MatrixCursor
import android.net.Uri
import android.provider.Telephony
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class SmsHistoryTest {
    @Test
    fun indexesOldThreadsWithoutReadingMessageBodies() {
        val provider = HistoryProvider()
        ShadowContentResolver.registerProviderInternal("sms", provider)
        val context = ApplicationProvider.getApplicationContext<Context>()
        val index = SmsStore.history(context)
        assertEquals(2, index.size)
        val messages = index.entries.single { it.key.number == "12345678" }.value
        assertEquals(5000, messages.size)
        assertEquals(0, provider.bodyRows)
        assertEquals("message 4901", SmsStore.bodies(context, messages.drop(99).take(1)).single().body)
        assertEquals(1, provider.bodyRows)
        assertEquals(1L, index.entries.single { it.key.number == "87654321" }.value.single().id)
    }

    private class HistoryProvider : ContentProvider() {
        var bodyRows = 0

        override fun onCreate() = true
        override fun getType(uri: Uri): String? = null
        override fun insert(uri: Uri, values: ContentValues?): Uri? = null
        override fun delete(uri: Uri, selection: String?, selectionArgs: Array<out String>?) = 0
        override fun update(uri: Uri, values: ContentValues?, selection: String?, selectionArgs: Array<out String>?) = 0

        override fun query(
            uri: Uri, projection: Array<out String>?, selection: String?,
            selectionArgs: Array<out String>?, sortOrder: String?,
        ): MatrixCursor {
            val columns = requireNotNull(projection).toList()
            val ids = when {
                columns == listOf(Telephony.Sms._ID) -> listOf(5001)
                selectionArgs != null -> selectionArgs.map(String::toInt)
                else -> (5001 downTo 1).toList()
            }
            return MatrixCursor(columns.toTypedArray()).apply {
                for (id in ids) {
                    addRow(columns.map { column ->
                        when (column) {
                            Telephony.Sms._ID, Telephony.Sms.DATE -> id
                            Telephony.Sms.ADDRESS -> if (id == 1) "87654321" else "12345678"
                            Telephony.Sms.TYPE -> Telephony.Sms.MESSAGE_TYPE_INBOX
                            Telephony.Sms.READ -> 1
                            Telephony.Sms.BODY -> {
                                bodyRows++
                                "message ${id - 1}"
                            }
                            else -> error("Unexpected column: $column")
                        }
                    })
                }
            }
        }
    }
}
