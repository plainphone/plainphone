// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import java.io.File
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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
        compose.onNodeWithText("Do you use another VPN, such as Tailscale or a work VPN?").assertIsDisplayed()
        capture("setup-other-vpn")
        compose.onNodeWithText("No, use Plainphone VPN").performClick()
        compose.onNodeWithText("How long can you undo setup?").assertIsDisplayed()
        compose.onNodeWithText("10 minutes (default)").performClick()
        compose.onNodeWithText("Choose your key").assertIsDisplayed()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("How long can you undo setup?").assertIsDisplayed()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Do you use another VPN, such as Tailscale or a work VPN?").assertIsDisplayed()
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
        compose.onNodeWithText("Yes, use Private DNS").performClick()
        compose.onNodeWithText("How long can you undo setup?").assertIsDisplayed()
        compose.onNodeWithText("10 minutes (default)").performClick()
        compose.onNodeWithText("Choose your key").assertIsDisplayed()
    }

    @Test fun waitThenTrustedEmailSavesTheTrustedKeyNotTheEarlierWait() {
        compose.onNodeWithText("Myself").performClick()
        compose.onNodeWithText("No, use Plainphone VPN").performClick()
        compose.onNodeWithText("30 minutes").performClick()
        compose.onNodeWithText("Advanced").performScrollTo().performClick()
        compose.onNodeWithText("Wait 12 h").performScrollTo().performClick()
        compose.onNodeWithText("Strict").performScrollTo().performClick()
        compose.onNodeWithText("Their email address").performTextInput("friend@example.org")
        compose.onNodeWithText("Continue").performClick()
        compose.onNodeWithText("Set up protection on your own phone?").assertIsDisplayed()
        compose.onNodeWithText("Continue").performClick()
        compose.runOnIdle {
            val key = checkNotNull(LightSetup.selfKey(compose.activity))
            assertEquals("trusted", key.getString("keyType"))
            assertEquals("friend@example.org", key.getString("trustedEmail"))
        }
    }

    private fun chooseKey(vararg taps: String) {
        compose.onNodeWithText("Myself").performClick()
        compose.onNodeWithText("No, use Plainphone VPN").performClick()
        compose.onNodeWithText("30 minutes").performClick()
        for (tap in taps) compose.onNodeWithText(tap).performScrollTo().performClick()
        compose.onNodeWithText("Continue").performClick()
        compose.onNodeWithText("Set up protection on your own phone?").assertIsDisplayed()
    }

    private fun savedKey(): org.json.JSONObject {
        compose.onNodeWithText("Continue").performClick()
        var key: org.json.JSONObject? = null
        compose.runOnIdle { key = LightSetup.selfKey(compose.activity) }
        return checkNotNull(key)
    }

    @Test fun theKeyStepOffersMildFirmAndStrictWithOneLineEach() {
        compose.onNodeWithText("Myself").performClick()
        compose.onNodeWithText("No, use Plainphone VPN").performClick()
        compose.onNodeWithText("30 minutes").performClick()
        compose.onNodeWithText("Mild").assertIsDisplayed()
        compose.onNodeWithText("A looser rule waits 1 hour.").assertIsDisplayed()
        compose.onNodeWithText("Firm").assertIsDisplayed()
        compose.onNodeWithText("A looser rule waits 24 hours.").assertIsDisplayed()
        compose.onNodeWithText("Strict").assertIsDisplayed()
        compose.onNodeWithText("A person you trust approves a looser rule.").assertIsDisplayed()
        // The other wait times are one tap away, not in the way.
        compose.onNodeWithText("Advanced").assertIsDisplayed()
        compose.onNodeWithText("Wait 6 h").assertDoesNotExist()
        compose.onNodeWithText("Advanced").performScrollTo().performClick()
        compose.onNodeWithText("Choose your own wait time").assertIsDisplayed()
        compose.onNodeWithText("Wait 6 h").assertIsDisplayed()
        capture("setup-key-levels")
    }

    @Test fun mildSavesAOneHourWait() {
        chooseKey("Mild")
        compose.onNodeWithText("Level: Mild").assertIsDisplayed()
        val key = savedKey()
        assertEquals("delay", key.getString("keyType"))
        assertEquals(1, key.getInt("delayHours"))
    }

    @Test fun firmSavesA24HourWait() {
        chooseKey("Firm")
        compose.onNodeWithText("Level: Firm").assertIsDisplayed()
        val key = savedKey()
        assertEquals("delay", key.getString("keyType"))
        assertEquals(24, key.getInt("delayHours"))
    }

    @Test fun strictSavesATrustedPersonAsBefore() {
        chooseKey("Strict", "Invite by QR code")
        compose.onNodeWithText("Level: Strict").assertIsDisplayed()
        assertEquals("trustedQr", savedKey().getString("keyType"))
    }

    @Test fun anotherWaitTimeIsCustomUnderAdvanced() {
        chooseKey("Advanced", "Wait 48 h")
        compose.onNodeWithText("Level: Custom").assertIsDisplayed()
        val key = savedKey()
        assertEquals("delay", key.getString("keyType"))
        assertEquals(48, key.getInt("delayHours"))
    }

    @Test fun refusedRuntimePermissionIsRememberedPerStepAndClearedWhenGranted() {
        val activity = compose.activity
        compose.runOnIdle {
            activity.recordPermissionResult(mapOf(android.Manifest.permission.POST_NOTIFICATIONS to false))
            assertEquals(1, PermissionRecovery.denials(activity, LightSetup.Step.RUNNING))
            assertTrue(PermissionRecovery.blocked(activity, LightSetup.Step.RUNNING)) // Robolectric: no rationale left
            assertEquals(0, PermissionRecovery.denials(activity, LightSetup.Step.LOCATION))

            activity.recordPermissionResult(mapOf(android.Manifest.permission.ACCESS_FINE_LOCATION to false))
            assertEquals(1, PermissionRecovery.denials(activity, LightSetup.Step.LOCATION))

            activity.recordPermissionResult(mapOf(android.Manifest.permission.POST_NOTIFICATIONS to true))
            assertEquals(0, PermissionRecovery.denials(activity, LightSetup.Step.RUNNING))
            assertEquals(false, PermissionRecovery.blocked(activity, LightSetup.Step.RUNNING))
        }
    }

    @Test fun backKeepsEveryChoiceAndTheSummaryNamesUndoWaitAndPendingHelper() {
        compose.onNodeWithText("Myself").performClick()
        compose.onNodeWithText("No, use Plainphone VPN").performClick()
        compose.onNodeWithText("30 minutes").performClick()
        compose.onNodeWithText("Advanced").performScrollTo().performClick()
        compose.onNodeWithText("Wait 12 h").performScrollTo().performClick()
        compose.onNodeWithText("Custom: A looser rule waits 12 hours.").assertExists()
        compose.onNodeWithText("Continue").performClick()
        compose.onNodeWithText("Set up protection on your own phone?").assertIsDisplayed()
        compose.onNodeWithText("You can undo setup for 30 minutes. Undoing switches Plainphone off without your key.").assertIsDisplayed()
        compose.onNodeWithText("Looser rules and removing Plainphone wait 12 h.").assertIsDisplayed()
        compose.onNodeWithText("Level: Custom").assertIsDisplayed()
        capture("setup-summary-wait")

        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Choose your key").assertIsDisplayed()
        compose.onNodeWithText("Custom: A looser rule waits 12 hours.").assertExists()
        compose.onNodeWithText("Strict").performScrollTo().performClick()
        compose.onNodeWithText("Invite by QR code").performScrollTo().performClick()
        capture("setup-key-qr")
        compose.onNodeWithText("Continue").performClick()
        compose.onNodeWithText(
            "A person you invite by QR code approves looser rules. Until they accept, changes wait 24 h.",
        ).assertIsDisplayed()
        capture("setup-summary-pending-buddy")

        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("How long can you undo setup?").assertIsDisplayed()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Back").performClick()
        compose.onNodeWithText("Whose phone is this?").assertIsDisplayed()
        // Choices survive even a trip through another audience.
        compose.onNodeWithText("Myself").performClick()
        compose.onNodeWithText("No, use Plainphone VPN").performClick()
        compose.onNodeWithText("30 minutes").performClick()
        compose.onNodeWithText("You can show the invite code as soon as your phone connects.").assertExists()
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
        compose.onNodeWithText("Choose Allow restricted settings.").assertIsDisplayed()
        capture("setup-restricted-settings")
        // The help is kept on disk, so it comes back after the app is closed and reopened.
        compose.runOnIdle { assertTrue(PermissionRecovery.restricted(activity, LightSetup.Step.PHONE)) }
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText(compose.activity.getString(R.string.setup_restricted_body)).assertIsDisplayed()
        compose.onNodeWithText("Open App info").performClick()
        compose.runOnIdle {
            assertEquals(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, shadowOf(compose.activity).nextStartedActivityForResult.intent.action)
        }
        compose.onNodeWithText("Try again").performClick()
        compose.runOnIdle {
            val request = checkNotNull(shadowOf(compose.activity).nextStartedActivityForResult)
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
