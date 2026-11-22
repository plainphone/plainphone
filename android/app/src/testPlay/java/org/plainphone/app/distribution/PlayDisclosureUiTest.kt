// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.distribution

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.app.AppOpsManager
import android.graphics.Bitmap
import android.os.Process
import android.provider.Settings
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.R
import org.plainphone.app.light.GuardService
import org.plainphone.app.light.LightAdminReceiver
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.LightSetupActivity
import org.plainphone.app.sync.PlainphoneApiReleaseTest.PairedStore
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowRoleManager

/**
 * The Play edition's setup: Child only, and a separate disclosure with an explicit yes before the
 * guard (accessibility) and location steps open Android's screens. Screenshots in
 * `app/build/screenshots/play-*.png`, light and dark.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(
    sdk = [35], qualifiers = "en-w393dp-h852dp-xxhdpi",
    shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"],
)
class PlayDisclosureUiTest {
    @get:Rule val compose = createAndroidComposeRule<LightSetupActivity>()
    private val activity get() = compose.activity

    private fun text(id: Int) = activity.getString(id)

    @Test fun setupOffersChildAndParentButNotMyself() = audience("light")

    @Test @Config(qualifiers = "+night") fun setupOffersChildAndParentButNotMyselfDark() = audience("dark")

    private fun audience(theme: String) {
        compose.onNodeWithText("Whose phone is this?").assertIsDisplayed()
        compose.onNodeWithText("Child").assertIsDisplayed()
        compose.onNodeWithText("Parent").assertIsDisplayed()
        compose.onNodeWithText("Myself").assertDoesNotExist()
        capture("play-audience-$theme")
        compose.onNodeWithText("Parent").performClick()
        compose.onNodeWithText("Open dashboard").assertIsDisplayed()
        compose.onNodeWithText("Want to use your own phone less? Set up Plainphone for yourself.").assertDoesNotExist()
    }

    @Test fun guardDisclosureComesBeforeAccessibilitySettings() = guard("light")

    @Test @Config(qualifiers = "+night") fun guardDisclosureComesBeforeAccessibilitySettingsDark() = guard("dark")

    private fun guard(theme: String) {
        compose.runOnIdle { readyUpTo(LightSetup.Step.GUARD) }
        startChildSetup()
        compose.onNodeWithText(text(R.string.disclosure_guard_title)).assertIsDisplayed()
        compose.onNodeWithText(text(R.string.disclosure_guard_body)).assertIsDisplayed()
        capture("play-disclosure-guard-$theme")
        compose.runOnIdle { assertThat(shadowOf(activity).nextStartedActivityForResult).isNull() }

        // Not now: nothing opens, the step waits, and the disclosure can be read again.
        compose.onNodeWithText(text(R.string.disclosure_not_now)).performClick()
        compose.onNodeWithText(text(R.string.disclosure_guard_declined)).assertIsDisplayed()
        capture("play-disclosure-guard-declined-$theme")
        compose.runOnIdle {
            assertThat(shadowOf(activity).nextStartedActivityForResult).isNull()
            assertThat(LightSetup.disclosureAgreed(activity, LightSetup.Step.GUARD)).isFalse()
            assertThat(LightSetup.next(activity)).isEqualTo(LightSetup.Step.GUARD)
        }
        compose.onNodeWithText(text(R.string.disclosure_read_again)).performClick()
        compose.onNodeWithText(text(R.string.disclosure_guard_body)).assertIsDisplayed()

        // Agree: only now does Android's accessibility list open.
        compose.onNodeWithText(text(R.string.disclosure_guard_agree)).performClick()
        compose.runOnIdle {
            assertThat(LightSetup.disclosureAgreed(activity, LightSetup.Step.GUARD)).isTrue()
            assertThat(shadowOf(activity).nextStartedActivityForResult.intent.action).isEqualTo(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        }
        compose.onNodeWithText(text(R.string.light_step_guard_action)).assertIsDisplayed()
    }

    @Test fun locationDisclosureComesBeforeThePermissionDialog() = location("light")

    @Test @Config(qualifiers = "+night") fun locationDisclosureComesBeforeThePermissionDialogDark() = location("dark")

    private fun location(theme: String) {
        compose.runOnIdle { readyUpTo(LightSetup.Step.LOCATION) }
        startChildSetup()
        compose.onNodeWithText(text(R.string.disclosure_location_body)).assertIsDisplayed()
        capture("play-disclosure-location-$theme")
        compose.runOnIdle { assertThat(shadowOf(activity).lastRequestedPermission).isNull() }
        compose.onNodeWithText(text(R.string.disclosure_location_agree)).performClick()
        compose.runOnIdle {
            assertThat(shadowOf(activity).lastRequestedPermission.requestedPermissions)
                .asList().contains(Manifest.permission.ACCESS_FINE_LOCATION)
        }
    }

    @Test fun notNowSkipsTheOptionalLocationStepWithoutAsking() {
        compose.runOnIdle { readyUpTo(LightSetup.Step.LOCATION) }
        startChildSetup()
        compose.onNodeWithText(text(R.string.disclosure_not_now)).performClick()
        compose.runOnIdle {
            assertThat(shadowOf(activity).lastRequestedPermission).isNull()
            assertThat(LightSetup.isSkipped(activity, LightSetup.Step.LOCATION)).isTrue()
            assertThat(LightSetup.next(activity)).isNotEqualTo(LightSetup.Step.LOCATION)
        }
    }

    /** Every step before [step] done the way Android reports it, on a paired phone with a PIN. */
    @Suppress("DEPRECATION") // Robolectric exposes role availability separately from role ownership.
    private fun readyUpTo(step: LightSetup.Step) {
        LightSetup.savePin(activity, "123456")
        val roles = Shadow.extract<ShadowRoleManager>(activity.getSystemService(RoleManager::class.java))
        roles.addHeldRole(RoleManager.ROLE_DIALER)
        roles.addHeldRole(RoleManager.ROLE_SMS)
        shadowOf(activity.getSystemService(AppOpsManager::class.java))
            .setMode(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), activity.packageName, AppOpsManager.MODE_ALLOWED)
        shadowOf(activity.getSystemService(DevicePolicyManager::class.java)).setActiveAdmin(LightAdminReceiver.component(activity))
        if (step == LightSetup.Step.LOCATION) {
            Settings.Secure.putString(
                activity.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
                ComponentName(activity, GuardService::class.java).flattenToString(),
            )
            LightSetup.skip(activity, LightSetup.Step.RUNNING)
        }
    }

    private fun startChildSetup() {
        compose.onNodeWithText("Child").performClick()
        compose.onNodeWithText("Continue").performClick()
    }

    private fun capture(name: String) {
        val dir = File("build/screenshots").apply { mkdirs() }
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        File(dir, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
