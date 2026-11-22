// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.time.MoreTime
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Who sees "Ask for more time", and that asking keeps every other way out. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class AskMoreTimeTest {
    @get:Rule
    val compose = createComposeRule()

    private val button = SemanticsMatcher.expectValue(SemanticsProperties.Role, Role.Button)

    @Test
    fun `asking opens an optional reason and sends what was typed`() {
        val sent = mutableListOf<String>()
        val taps = mutableListOf<String>()
        compose.setContent {
            var state by remember { mutableStateOf<MoreTime.Ui>(MoreTime.Ui.Offer) }
            PlainphoneTheme {
                BlockedScreen(
                    BlockedActivity.Reason.TIME_USED_UP, "Spotify", onHome = { taps += "home" }, onReachParent = { taps += "parent" },
                    onEnterPin = {}, ask = state, onAsk = { state = MoreTime.Ui.Composing },
                    onSendAsk = { sent += it; state = MoreTime.Ui.Saved },
                )
            }
        }
        compose.onNodeWithText("Ask for more time").assert(button).performClick()
        compose.onNodeWithText("Tell your parent why (optional)").performTextInput("Finishing a playlist")
        compose.onNodeWithText("Send").assert(button).performClick()
        assertThat(sent).containsExactly("Finishing a playlist")
        compose.onNodeWithText("Saved").assertIsDisplayed()
        compose.onNodeWithText("It is sent when the phone is online.").assertIsDisplayed()
        // The old ways out are unchanged.
        compose.onNodeWithText("Call or message a parent").performClick()
        compose.onNodeWithText("Back to start").performClick()
        assertThat(taps).containsExactly("parent", "home").inOrder()
    }

    @Test
    fun `the reason stops at 140 characters`() {
        val sent = mutableListOf<String>()
        compose.setContent { PlainphoneTheme { AskMoreTime(MoreTime.Ui.Composing, onAsk = {}, onSend = { sent += it }) } }
        compose.onNodeWithText("Tell your parent why (optional)").performTextInput("a".repeat(200))
        compose.onNodeWithText("Send").performClick()
        assertThat(sent.single()).hasLength(140)
    }

    @Test
    fun `without the switch there is no ask, and the screen is as before`() {
        compose.setContent {
            PlainphoneTheme { BlockedScreen(BlockedActivity.Reason.TIME_USED_UP, "Spotify", {}, {}, {}, ask = null) }
        }
        compose.onNodeWithText("Ask for more time").assertDoesNotExist()
        compose.onNodeWithText("Call or message a parent").assertIsDisplayed()
    }

    @Test
    fun `a Self profile has nobody to ask`() {
        compose.setContent {
            PlainphoneTheme { BlockedScreen(BlockedActivity.Reason.TIME_USED_UP, "Spotify", {}, {}, {}, showParent = false, ask = MoreTime.Ui.Offer) }
        }
        compose.onNodeWithText("Ask for more time").assertDoesNotExist()
        compose.onNodeWithText("Back to start").assertIsDisplayed()
    }

    @Test
    fun `only a used-up time limit offers it`() {
        compose.setContent {
            PlainphoneTheme { BlockedScreen(BlockedActivity.Reason.NOT_ALLOWED, "Spotify", {}, {}, {}, ask = MoreTime.Ui.Offer) }
        }
        compose.onNodeWithText("Ask for more time").assertDoesNotExist()
    }

    @Test
    fun `the approved answer names the new end time`() {
        compose.setContent { PlainphoneTheme { AskMoreTime(MoreTime.Ui.Approved("14:35"), {}, {}) } }
        compose.onNodeWithText("A parent said yes").assertIsDisplayed()
        compose.onNodeWithText("Until 14:35").assertIsDisplayed()
    }

    @Test
    fun `the stop screen asks the rules, switched off or a Self profile means no ask`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val limits = """{"apps":[{"packageName":"com.spotify.music","minutes":0}]}"""
        fun state(rules: JSONObject): MoreTime.Ui? {
            SyncStore(context).saveRules("\"e\"", rules.toString(), 0L)
            return AskMoreTimeController(context, "com.spotify.music").state(online = false)
        }
        val base = JSONObject(rulesJson(timeLimits = limits))
        assertThat(state(base)).isEqualTo(MoreTime.Ui.Offer)
        assertThat(state(JSONObject(base.toString()).put("askMoreTimeEnabled", false))).isNull()
        assertThat(state(JSONObject(base.toString()).put("profile", "self"))).isNull()
    }

    @Test
    fun `an ask made after the switch went off is not saved`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val limits = """{"apps":[{"packageName":"com.spotify.music","minutes":0}]}"""
        val off = JSONObject(rulesJson(timeLimits = limits)).put("askMoreTimeEnabled", false)
        SyncStore(context).saveRules("\"e\"", off.toString(), 0L)
        assertThat(AskMoreTimeController(context, "com.spotify.music").ask("one more")).isNull()
        val today = java.time.LocalDate.now()
        assertThat(SyncStore(context).moreTime.all(today)).isEmpty()
    }
}
