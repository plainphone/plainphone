// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.click
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.unit.Density
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.light.BlockedActivity
import org.plainphone.app.telephony.SmsMessage
import org.plainphone.app.ui.Bubble
import org.plainphone.app.ui.PlainphoneTheme
import org.plainphone.app.ui.draftAfterRetry
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class ChildNextActionTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun `a used-up app offers the way home and a parent`() {
        val taps = mutableListOf<String>()
        compose.setContent {
            PlainphoneTheme {
                GuardFixture.screen(BlockedActivity.Reason.TIME_USED_UP, onHome = { taps += "home" }, onParent = { taps += "parent" })
            }
        }
        compose.onNodeWithText("Time is up for today").assertIsDisplayed()
        compose.onNodeWithText("Back to start").performClick()
        compose.onNodeWithText("Call or message a parent").performClick()
        assertThat(taps).containsExactly("home", "parent").inOrder()
    }

    @Test
    fun `an unknown reason gets neutral wording, not an accusation`() {
        compose.setContent { PlainphoneTheme { GuardFixture.screen(BlockedActivity.Reason.OTHER) } }
        compose.onNodeWithText("This is not available right now").assertIsDisplayed()
        compose.onNodeWithText("Call or message a parent").assertIsDisplayed()
    }

    @Test
    fun `parent and emergency routes stay on screen at large text and the call button does not read the number`() {
        val taps = mutableListOf<String>()
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, 2f)) {
                PlainphoneTheme {
                    DialerFixture.keypad(onCall = { taps += "call:$it" }, onParents = { taps += "parents" }, onEmergency = { taps += "112" })
                }
            }
        }
        compose.onNodeWithText("Call a parent").assertIsDisplayed().performClick()
        val emergency = compose.onNodeWithText("Call 112").assertIsDisplayed()
        emergency.performTouchInput { click() }
        compose.onNodeWithText("Hold to call 112.").assertIsDisplayed()
        compose.runOnIdle { assertThat(taps).containsExactly("parents") }
        compose.mainClock.autoAdvance = false
        emergency.performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(3_100)
        emergency.performTouchInput { up() }
        compose.mainClock.autoAdvance = true
        compose.onNodeWithContentDescription("Call").performClick()
        compose.onNodeWithContentDescription("Delete last digit").assertIsDisplayed()
        compose.onNodeWithContentDescription("Call 2012").assertDoesNotExist()
        assertThat(taps).containsExactly("parents", "112", "call:2012").inOrder()
    }

    @Test
    fun `a message that did not go through offers to write it again`() {
        var retried = 0
        val failed = SmsMessage(1, "+4500000000", "See you at four", 0, outgoing = true, failed = true, read = true)
        compose.setContent { PlainphoneTheme { Bubble(failed, onRetry = { retried++ }) } }
        compose.onNodeWithText("Not sent").assertIsDisplayed()
        compose.onNodeWithText("Write it again").performClick()
        assertThat(retried).isEqualTo(1)
    }

    @Test
    fun `writing a failed message again keeps what is already typed`() {
        assertThat(draftAfterRetry("", "See you at four")).isEqualTo("See you at four")
        assertThat(draftAfterRetry("  ", "See you at four")).isEqualTo("See you at four")
        assertThat(draftAfterRetry("Hi ", "See you at four")).isEqualTo("Hi\nSee you at four")
    }
}
