// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.click
import androidx.compose.ui.test.isDialog
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.SemanticsNodeInteraction
import java.io.File
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.test.performSemanticsAction
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
    fun `accessibility activation can confirm a timed action`() {
        var completed = 0
        compose.setContent {
            HoldAction("Call 112", onTap = {}, onHeld = { completed++ })
        }
        saveScreenshot("sos-before-confirmation", compose.onRoot())
        compose.onNodeWithText("Call 112").performSemanticsAction(SemanticsActions.OnClick)
        saveScreenshot("sos-accessible-confirmation", compose.onNode(isDialog()))
        compose.runOnIdle { assertThat(completed).isEqualTo(0) }
        compose.onNodeWithText("Confirm").performTouchInput { click() }
        compose.waitUntil(timeoutMillis = 5_000) { completed == 1 }
        compose.runOnIdle { assertThat(completed).isEqualTo(1) }
    }

    private fun saveScreenshot(name: String, node: SemanticsNodeInteraction) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use {
            check(node.captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it))
        }
    }

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
