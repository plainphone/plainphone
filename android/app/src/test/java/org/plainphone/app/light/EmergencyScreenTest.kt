// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ActivityInfo
import android.content.pm.PackageInfo
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.R
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** "Emergency opening" on the stop screen: only for a Self phone, only when switched on, calm and plain. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class EmergencyScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val game = "com.example.game"

    private fun screen(
        reason: BlockedActivity.Reason = BlockedActivity.Reason.NOT_ALLOWED,
        showParent: Boolean = false,
        offer: EmergencyOffer? = EmergencyOffer(2, 15),
        confirming: Boolean = false,
        message: Int? = null,
        taps: MutableList<String> = mutableListOf(),
    ) = compose.setContent {
        PlainphoneTheme {
            BlockedScreen(
                reason, "Spotify", onHome = {}, onReachParent = {}, onEnterPin = {}, showParent = showParent,
                emergency = offer, emergencyConfirming = confirming, emergencyMessage = message,
                onEmergency = { taps += "start" }, onEmergencyOpen = { taps += "open" }, onEmergencyCancel = { taps += "cancel" },
            )
        }
    }

    @Test fun `a button and how many are left`() {
        val taps = mutableListOf<String>()
        screen(taps = taps)
        compose.onNodeWithText("Emergency opening").assertIsDisplayed().performClick()
        compose.onNodeWithText("2 left this month").assertIsDisplayed()
        assertThat(taps).containsExactly("start")
        compose.onNodeWithText("Back to start").assertIsDisplayed()
    }

    @Test fun `the confirm step names the app, the minutes, the count and who is told`() {
        val taps = mutableListOf<String>()
        screen(confirming = true, offer = EmergencyOffer(1, 15), taps = taps)
        compose.onNodeWithText("Open Spotify for 15 minutes?").assertIsDisplayed()
        compose.onNodeWithText("1 left this month").assertIsDisplayed()
        compose.onNodeWithText("The person you trust will be told.").assertIsDisplayed()
        compose.onNodeWithText("Open").performClick()
        compose.onNodeWithText("Cancel").performClick()
        assertThat(taps).containsExactly("open", "cancel").inOrder()
    }

    @Test fun `a used-up limit can be opened too`() {
        screen(reason = BlockedActivity.Reason.TIME_USED_UP)
        compose.onNodeWithText("Emergency opening").assertIsDisplayed()
    }

    @Test fun `with none left it says so and shows no button`() {
        screen(offer = EmergencyOffer(0, 15))
        compose.onNodeWithText("No emergency openings left this month").assertIsDisplayed()
        compose.onNodeWithText("Emergency opening").assertDoesNotExist()
    }

    @Test fun `a refusal is said calmly`() {
        screen(message = R.string.emergency_busy)
        compose.onNodeWithText("Another app is open on an emergency opening. Try again when it ends.").assertIsDisplayed()
    }

    @Test fun `a protection screen, a Child phone or no offer shows nothing`() {
        screen(reason = BlockedActivity.Reason.PROTECTION)
        compose.onNodeWithText("Emergency opening").assertDoesNotExist()
        compose.onNodeWithText("2 left this month").assertDoesNotExist()
    }

    @Test fun `a Child phone never sees it`() {
        screen(showParent = true)
        compose.onNodeWithText("Emergency opening").assertDoesNotExist()
        compose.onNodeWithText("Call or message a parent").assertIsDisplayed()
    }

    @Test fun `switched off shows nothing`() {
        screen(offer = null)
        compose.onNodeWithText("Emergency opening").assertDoesNotExist()
        compose.onNodeWithText("Back to start").assertIsDisplayed()
    }

    // --- the controller, against stored rules ------------------------------------------------

    private fun rules(profile: String = "self", selfEmergency: String? = """{"enabled":true,"allowance":2,"minutes":15,"used":{"month":"2000-01","count":0}}""") {
        val doc = JSONObject(rulesJson()).put("profile", profile)
        if (selfEmergency != null) doc.put("selfEmergency", JSONObject(selfEmergency))
        SyncStore(context).saveRules("\"e\"", doc.toString(), 0L)
    }

    private fun installLauncherApp(pkg: String) {
        val pm = shadowOf(context.packageManager)
        pm.installPackage(PackageInfo().apply { packageName = pkg })
        val component = ComponentName(pkg, "$pkg.Main")
        pm.addActivityIfNotPresent(component)
        pm.addIntentFilterForActivity(component, IntentFilter(Intent.ACTION_MAIN).apply { addCategory(Intent.CATEGORY_LAUNCHER) })
    }

    @Test fun `the controller offers only when the rules switch it on for a Self phone`() {
        rules()
        assertThat(EmergencyController(context, game, BlockedActivity.Reason.NOT_ALLOWED).offer()).isEqualTo(EmergencyOffer(2, 15))
        assertThat(EmergencyController(context, game, BlockedActivity.Reason.PROTECTION).offer()).isNull()
        assertThat(EmergencyController(context, context.packageName, BlockedActivity.Reason.NOT_ALLOWED).offer()).isNull()
        rules(selfEmergency = """{"enabled":false,"allowance":2,"minutes":15}""")
        assertThat(EmergencyController(context, game, BlockedActivity.Reason.NOT_ALLOWED).offer()).isNull()
        rules(selfEmergency = null)
        assertThat(EmergencyController(context, game, BlockedActivity.Reason.NOT_ALLOWED).offer()).isNull()
        rules(profile = "child")
        assertThat(EmergencyController(context, game, BlockedActivity.Reason.NOT_ALLOWED).offer()).isNull()
    }

    @Test fun `opening records first, offline, then hands back the app to launch`() {
        rules()
        installLauncherApp(game)
        val controller = EmergencyController(context, game, BlockedActivity.Reason.NOT_ALLOWED)
        val outcome = controller.open()
        assertThat(outcome).isInstanceOf(EmergencyOutcome.Opened::class.java)
        assertThat((outcome as EmergencyOutcome.Opened).launch.`package` ?: outcome.launch.component?.packageName).isEqualTo(game)
        val store = SyncStore(context)
        assertThat(store.emergencyOpenings.pending().map { it.packageName }).containsExactly(game)
        assertThat(store.emergencyOpenings.isActive(game)).isTrue()
        // One of two used; the next offer says one is left.
        assertThat(controller.offer()).isEqualTo(EmergencyOffer(1, 15))
        assertThat(EmergencyController.statusLeft(context)).isEqualTo(1)
    }

    @Test fun `opening is refused when it is switched off, and nothing is recorded`() {
        rules(selfEmergency = """{"enabled":false,"allowance":2,"minutes":15}""")
        installLauncherApp(game)
        val outcome = EmergencyController(context, game, BlockedActivity.Reason.NOT_ALLOWED).open()
        assertThat(outcome).isInstanceOf(EmergencyOutcome.Refused::class.java)
        assertThat(SyncStore(context).emergencyOpenings.pending()).isEmpty()
    }

    @Test fun `a second opening while one is open is refused with the calm message`() {
        rules()
        installLauncherApp(game)
        installLauncherApp("com.example.video")
        assertThat(EmergencyController(context, game, BlockedActivity.Reason.NOT_ALLOWED).open()).isInstanceOf(EmergencyOutcome.Opened::class.java)
        val second = EmergencyController(context, "com.example.video", BlockedActivity.Reason.NOT_ALLOWED).open()
        assertThat(second).isEqualTo(EmergencyOutcome.Refused(R.string.emergency_busy))
        assertThat(SyncStore(context).emergencyOpenings.pending()).hasSize(1)
    }

    @Test fun `the status line only exists while the feature is on`() {
        rules()
        assertThat(EmergencyController.statusLeft(context)).isEqualTo(2)
        rules(selfEmergency = """{"enabled":false,"allowance":2,"minutes":15}""")
        assertThat(EmergencyController.statusLeft(context)).isNull()
        rules(profile = "child")
        assertThat(EmergencyController.statusLeft(context)).isNull()
    }
}
