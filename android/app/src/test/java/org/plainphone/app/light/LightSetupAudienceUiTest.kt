// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import java.io.File
import org.junit.Assert.assertNull
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import android.graphics.Bitmap
import org.plainphone.app.R

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w393dp-h852dp-xxhdpi")
class LightSetupAudienceUiTest {
    @get:Rule val compose = createAndroidComposeRule<LightSetupActivity>()

    @Test fun parentCanOpenDashboardOrPreviewSelfWithoutStartingPermissionSetup() {
        val activity = compose.activity
        compose.onNodeWithText("Whose phone is this?").assertIsDisplayed()
        capture("setup-audience")
        compose.onNodeWithText("Parent").performClick()
        compose.onNodeWithText("Open dashboard").assertIsDisplayed()
        capture("setup-parent")
        compose.runOnIdle {
            assertNull(LightSetup.profile(activity))
            assertNull(shadowOf(activity).nextStartedActivityForResult)
        }
        compose.onNodeWithText("Want to use your own phone less? Set up Plainphone for yourself.").performClick()
        compose.onNodeWithText("Set up protection on your own phone?").assertIsDisplayed()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Child").performClick()
        compose.onNodeWithText("Is this your child’s phone?").assertIsDisplayed()
        compose.runOnIdle {
            assertNull(LightSetup.profile(activity))
            assertNull(shadowOf(activity).nextStartedActivityForResult)
        }
        compose.onNodeWithText("Continue").performClick()
        compose.onNodeWithText(activity.getString(R.string.light_step_pin_title)).assertIsDisplayed()
    }

    private fun capture(name: String) {
        val dir = File("build/screenshots").apply { mkdirs() }
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        File(dir, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
