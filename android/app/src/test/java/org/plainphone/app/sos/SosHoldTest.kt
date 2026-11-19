// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performTouchInput
import com.google.common.truth.Truth.assertThat
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35])
class SosHoldTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun `a tap gives the hold hint and a three second press acts once`() {
        var hints = 0
        var completed = 0
        compose.setContent {
            HoldAction("Call 112", onTap = { hints++ }, onHeld = { completed++ })
        }

        val button = compose.onNodeWithText("Call 112")
        button.performTouchInput { click() }
        compose.runOnIdle {
            assertThat(hints).isEqualTo(1)
            assertThat(completed).isEqualTo(0)
        }

        compose.mainClock.autoAdvance = false
        button.performTouchInput { down(center) }
        compose.mainClock.advanceTimeBy(2_950)
        compose.runOnIdle { assertThat(completed).isEqualTo(0) }
        compose.mainClock.advanceTimeBy(150)
        button.performTouchInput { up() }
        compose.runOnIdle { assertThat(completed).isEqualTo(1) }
    }
}
