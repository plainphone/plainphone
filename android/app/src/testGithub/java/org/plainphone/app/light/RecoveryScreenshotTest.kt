// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.app.Activity
import android.app.role.RoleManager
import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.R
import org.plainphone.app.sync.SyncStore
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowRoleManager

/**
 * Before/after screenshots for the permission-recovery and Myself-setup screens (light and dark).
 * Written to `app/build/screenshots/recovery-*.png`. It only taps visible labels that exist on
 * both sides of the change, so the same file runs against the old and the new code.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w393dp-h852dp-xxhdpi")
class RecoveryScreenshotTest {
    @get:Rule val compose = createAndroidComposeRule<LightSetupActivity>()

    @Test fun myselfSetupLight() = myselfSetup("light")

    @Test @Config(qualifiers = "+night") fun myselfSetupDark() = myselfSetup("dark")

    private fun myselfSetup(theme: String) {
        compose.onNodeWithText("Myself").performClick()
        compose.onNodeWithText("No, use Plainphone VPN").performClick()
        capture("recovery-undo-$theme")
        compose.onNodeWithText("30 minutes").performClick()
        compose.onNodeWithText("Advanced").performScrollTo().performClick()
        compose.onNodeWithText("Wait 12 h").performScrollTo().performClick()
        capture("recovery-key-$theme")
        compose.onNodeWithText("Continue").performClick()
        capture("recovery-confirm-$theme")
    }

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun restrictedSettingsLight() = restrictedSettings("light")

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"], qualifiers = "+night")
    fun restrictedSettingsDark() = restrictedSettings("dark")

    @Suppress("DEPRECATION") // Robolectric exposes role availability separately from role ownership.
    private fun restrictedSettings(theme: String) {
        val activity = compose.activity
        compose.runOnIdle {
            LightSetup.savePin(activity, "123456")
            val roles = Shadow.extract<ShadowRoleManager>(activity.getSystemService(RoleManager::class.java))
            roles.addAvailableRole(RoleManager.ROLE_DIALER)
        }
        compose.onNodeWithText("Child").performClick()
        compose.onNodeWithText("Continue").performClick()
        capture("recovery-step-$theme")
        compose.onNodeWithText(activity.getString(R.string.light_step_phone_action)).performClick()
        compose.runOnIdle {
            val request = checkNotNull(shadowOf(activity).nextStartedActivityForResult)
            activity.activityResultRegistry.dispatchResult(request.requestCode, Activity.RESULT_CANCELED, null)
        }
        compose.waitForIdle()
        capture("recovery-restricted-$theme")
    }

    @Implements(SyncStore::class)
    class PairedStore {
        @Implementation fun isPaired(): Boolean = true
    }

    private fun capture(name: String) {
        val dir = File("build/screenshots").apply { mkdirs() }
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        File(dir, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
