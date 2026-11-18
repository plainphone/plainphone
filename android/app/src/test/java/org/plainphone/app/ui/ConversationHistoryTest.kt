// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasScrollToIndexAction
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToIndex
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.telephony.SmsHistoryTest.HistoryProvider
import org.plainphone.app.telephony.SmsThread
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowContentResolver

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "en-w393dp-h852dp")
class ConversationHistoryTest {
    @get:Rule
    val compose = createComposeRule()

    private lateinit var provider: HistoryProvider

    @After
    fun closeProvider() = provider.db.close()

    @Test
    fun resumeRevealsImportedPagesAndKeepsTheVisibleOlderMessage() {
        provider = HistoryProvider()
        for (authority in listOf("sms", "mms", "mms-sms")) {
            ShadowContentResolver.registerProviderInternal(authority, provider)
        }
        provider.db.delete("sms", "_id < 4982", null)
        val resumed = mutableIntStateOf(0)
        val thread = SmsThread("12345678", systemId = 7)
        val listState = LazyListState()
        val list = compose.onNode(hasScrollToIndexAction())
        val older = compose.onNodeWithText("Load older")
        compose.setContent {
            PlainphoneTheme {
                ConversationScreen(null, 0, resumed.intValue, thread, "", {}, {}, listState)
            }
        }
        awaitItems(listState, 20)
        older.assertDoesNotExist()

        provider.db.execSQL("""
            WITH RECURSIVE ids(id) AS (VALUES(4900) UNION ALL SELECT id + 1 FROM ids WHERE id < 4981)
            INSERT INTO sms SELECT id, 7, '12345678', id, 1, 1, 'message ' || id FROM ids
        """.trimIndent())
        compose.runOnIdle { resumed.intValue++ }
        awaitItems(listState, 51)
        list.performScrollToIndex(50)
        older.performClick()
        awaitItems(listState, 101)
        list.performScrollToIndex(60)
        compose.onNodeWithText("message 4941").assertIsDisplayed()

        val offset = compose.runOnIdle { listState.firstVisibleItemScrollOffset }
        provider.db.execSQL("INSERT INTO sms VALUES (5002, 7, '12345678', 5002, 1, 1, 'new message')")
        compose.runOnIdle { resumed.intValue++ }
        awaitItems(listState, 102)
        compose.runOnIdle {
            assertEquals(61, listState.firstVisibleItemIndex)
            assertEquals(offset, listState.firstVisibleItemScrollOffset)
        }
        compose.onNodeWithText("message 4941").assertIsDisplayed()
        list.performScrollToIndex(0)
        compose.onNodeWithText("new message").assertIsDisplayed()
    }

    private fun awaitItems(state: LazyListState, count: Int) {
        compose.waitUntil(timeoutMillis = 10_000) {
            compose.runOnIdle { state.layoutInfo.totalItemsCount == count }
        }
    }
}
