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
import android.app.Activity
import android.content.Intent
import android.app.role.RoleManager
import android.graphics.Bitmap
import android.provider.Settings
import org.junit.Assert.assertEquals
import org.plainphone.app.sync.SyncStore
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowRoleManager
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

    @Test fun canChangeAudienceBeforePairing() {
        compose.onNodeWithText("Child").performClick()
        compose.onNodeWithText("Continue").performClick()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Myself").performClick()
        compose.onNodeWithText("Set up protection on your own phone?").assertIsDisplayed()
    }

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"])
    @Suppress("DEPRECATION") // Robolectric exposes role availability separately from role ownership.
    fun deniedDialerRequestOffersAppInfoAndRetriesTheRole() {
        val activity = compose.activity
        compose.runOnIdle {
            LightSetup.savePin(activity, "123456")
            val roles = Shadow.extract<ShadowRoleManager>(activity.getSystemService(RoleManager::class.java))
            roles.addAvailableRole(RoleManager.ROLE_DIALER)
        }
        compose.onNodeWithText("Child").performClick()
        compose.onNodeWithText("Continue").performClick()
        val action = activity.getString(R.string.light_step_phone_action)
        compose.onNodeWithText(action).performClick()
        lateinit var firstRequest: Intent
        compose.runOnIdle {
            val request = checkNotNull(shadowOf(activity).nextStartedActivityForResult)
            firstRequest = request.intent
            activity.activityResultRegistry.dispatchResult(request.requestCode, Activity.RESULT_CANCELED, null)
        }
        compose.onNodeWithText(activity.getString(R.string.setup_restricted_body)).assertIsDisplayed()
        compose.onNodeWithText("Open App info").performClick()
        compose.runOnIdle {
            assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, shadowOf(activity).nextStartedActivityForResult.intent.action)
        }
        compose.onNodeWithText("Try again").performClick()
        compose.runOnIdle {
            val request = checkNotNull(shadowOf(activity).nextStartedActivityForResult)
            assertEquals(firstRequest.action, request.intent.action)
            assertEquals(firstRequest.extras?.toString(), request.intent.extras?.toString())
        }
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
