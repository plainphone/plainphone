// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Holding the home screen clock sends a silent SOS only when the parents switched it on (docs/sos.md). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class ClockHoldTest {
    @get:Rule
    val compose = createComposeRule()

    private var held = 0

    private fun show(hiddenClock: Boolean) {
        compose.setContent {
            HomeTheme(homeColors(HomePalette.SAGE, false)) {
                HomeScreen(
                    HomeUi(HomeState(HomePrefs.DEFAULT, emptyList(), emptyList(), null), "14:31", "Monday 4 January", hiddenClock = hiddenClock),
                    showAll = false, onShowAll = {}, actions = HomeActions(clockHeld = { held++ }),
                )
            }
        }
    }

    @Test
    fun `a long hold on the clock sends once when it is on`() {
        show(hiddenClock = true)
        compose.onNodeWithText("14:31", useUnmergedTree = true).performTouchInput { longClick(durationMillis = CLOCK_HOLD_MS + 300) }
        compose.waitForIdle()
        assertThat(held).isEqualTo(1)
    }

    @Test
    fun `an ordinary long press is not enough`() {
        show(hiddenClock = true)
        compose.onNodeWithText("14:31", useUnmergedTree = true).performTouchInput { longClick(durationMillis = 700) }
        compose.waitForIdle()
        assertThat(held).isEqualTo(0)
    }

    @Test
    fun `when it is off the clock is only a clock`() {
        show(hiddenClock = false)
        compose.onNodeWithText("14:31", useUnmergedTree = true).performTouchInput { longClick(durationMillis = CLOCK_HOLD_MS + 300) }
        compose.waitForIdle()
        assertThat(held).isEqualTo(0)
    }
}
