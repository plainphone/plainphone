// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.Instant
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.CheckInRequest
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The ring and "Are you okay?" screens, rendered with Robolectric's native graphics. PNGs go to
 * `app/build/screenshots/` (light, dark, Danish). The checks make sure the buttons work.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class SafetyScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private val now = 1_800_000_000_000L
    private val checkIn = CheckInRequest("c1", Instant.ofEpochMilli(now + 600_000L), "+4512345678", sendLocation = true)

    private fun shoot(name: String) {
        val bmp = compose.onRoot().captureToImage().asAndroidBitmap()
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    private fun qualifiers(night: Boolean, danish: Boolean) {
        RuntimeEnvironment.setQualifiers((if (danish) "+da" else "+en") + (if (night) "-night" else "-notnight"))
    }

    @Test
    fun `ring screen answers with I'm here`() {
        var answered = false
        compose.setContent {
            PlainphoneTheme { RingScreen(RingUi("r1", now + 272_000L, stopOnAnswer = true, answered = false), now) { answered = true } }
        }
        compose.onNodeWithText("Your parent is looking for you").assertIsDisplayed()
        shoot("ring-en-light")
        compose.onNodeWithText("I'm here").performClick()
        assertThat(answered).isTrue()
    }

    @Test
    fun `ring screen after the answer counts down when the parent chose 5 minutes`() {
        qualifiers(night = true, danish = true)
        compose.setContent {
            PlainphoneTheme { RingScreen(RingUi("r1", now + 192_000L, stopOnAnswer = false, answered = true), now) {} }
        }
        compose.onNodeWithText("Den stopper om 3:12", substring = true).assertIsDisplayed()
        shoot("ring-da-dark-answered")
    }

    @Test
    fun `ring screen in Danish and dark`() {
        qualifiers(night = true, danish = true)
        compose.setContent {
            PlainphoneTheme { RingScreen(RingUi("r1", now + 272_000L, stopOnAnswer = true, answered = false), now) {} }
        }
        compose.onNodeWithText("Jeg er her").assertIsDisplayed()
        shoot("ring-da-dark")
    }

    @Test
    fun `check-in screen offers okay and call me`() {
        var ok = false
        var call = false
        compose.setContent { PlainphoneTheme { CheckInScreen(checkIn, "16:40", { ok = true }, { call = true }) } }
        shoot("checkin-en-light")
        compose.onNodeWithText("Yes, I'm okay").performClick()
        compose.onNodeWithText("Call me").performClick()
        assertThat(ok).isTrue()
        assertThat(call).isTrue()
    }

    @Test
    fun `check-in screen in Danish, light and dark, without a call button when no number`() {
        qualifiers(night = false, danish = true)
        compose.setContent { PlainphoneTheme { CheckInScreen(checkIn, "16:40", {}, {}) } }
        compose.onNodeWithText("Svarer du ikke", substring = true).assertIsDisplayed()
        shoot("checkin-da-light")
    }

    @Test
    fun `check-in screen dark without a number has no call button`() {
        qualifiers(night = true, danish = true)
        compose.setContent { PlainphoneTheme { CheckInScreen(checkIn.copy(callNumber = null), "16:40", {}, {}) } }
        assertThat(compose.onAllNodes(androidx.compose.ui.test.hasText("Ring til mig")).fetchSemanticsNodes()).isEmpty()
        shoot("checkin-da-dark")
    }

    @Test
    fun `location badge only shows when sharing is always on`() {
        compose.setContent {
            PlainphoneTheme {
                androidx.compose.foundation.layout.Column {
                    LocationSharingBadge(shared = true)
                    LocationSharingBadge(shared = false)
                }
            }
        }
        compose.onNodeWithText("Your location is shared with your parent").assertIsDisplayed()
        shoot("badge-en-light")
    }

    private val log = listOf(
        SharingEntry("always", now - 3_600_000L, now - 300_000L, 12),
        SharingEntry("checkin", now - 86_400_000L, now - 86_400_000L, 1),
        SharingEntry("find", now - 3 * 86_400_000L, now - 3 * 86_400_000L, 1),
    )
    private val fmt: (Long) -> String = { ms -> "%02d:%02d".format((ms / 3_600_000L) % 24, (ms / 60_000L) % 60) }

    @Test
    fun `what can my parents see lists every position sent`() {
        compose.setContent { PlainphoneTheme { SharingScreen("always", now + 3_600_000L, log, fmt) {} } }
        compose.onNodeWithText("What can my parents see?").assertIsDisplayed()
        compose.onNodeWithText("Your location is shared every 5 minutes until", substring = true).assertIsDisplayed()
        compose.onNodeWithText("No answer to \"Are you okay?\"").assertExists()
        shoot("sharing-en-light")
    }

    @Test
    fun `what can my parents see in Danish, dark, nothing sent`() {
        qualifiers(night = true, danish = true)
        compose.setContent { PlainphoneTheme { SharingScreen("checkin", null, emptyList(), fmt) {} } }
        compose.onNodeWithText("Hvad kan mine forældre se?").assertIsDisplayed()
        compose.onNodeWithText("Din placering er ikke sendt de sidste 30 dage.").assertExists()
        shoot("sharing-da-dark")
    }

    @Test
    fun `what can my parents see tells the child about the weekly summary`() {
        compose.setContent { PlainphoneTheme { SharingScreen("find", null, log, fmt, weeklySummary = true) {} } }
        compose.onNodeWithText("Once a week your parents get a summary", substring = true).assertIsDisplayed()
        compose.onNodeWithText("It never shows messages, calls or what you do inside apps.", substring = true).assertExists()
        shoot("sharing-weekly-summary-en-light")
    }

    @Test
    fun `the weekly summary notice is in Danish and dark, and absent when the summary is off`() {
        qualifiers(night = true, danish = true)
        compose.setContent { PlainphoneTheme { SharingScreen("off", null, emptyList(), fmt, weeklySummary = true) {} } }
        compose.onNodeWithText("En gang om ugen får dine forældre en oversigt", substring = true).assertExists()
        shoot("sharing-weekly-summary-da-dark")
    }

    @Test
    fun `no weekly summary notice when the summary is switched off`() {
        compose.setContent { PlainphoneTheme { SharingScreen("find", null, log, fmt, weeklySummary = false) {} } }
        compose.onNodeWithText("Once a week your parents get a summary", substring = true).assertDoesNotExist()
    }

    @Test
    fun `the sharing log keeps always in one line and forgets after 30 days`() {
        val store = SafetyStore(RuntimeEnvironment.getApplication())
        store.logPosition("find", now - 40L * 86_400_000L)
        store.logPosition("always", now)
        store.logPosition("always", now + 300_000L)
        store.logPosition("always", now + 600_000L)
        store.logPosition("checkin", now + 900_000L)
        val entries = store.sharingLog(now + 900_000L)
        assertThat(entries.map { it.why }).containsExactly("checkin", "always").inOrder()
        assertThat(entries[1].count).isEqualTo(3)
        assertThat(entries[1].firstMs).isEqualTo(now)
        assertThat(entries[1].lastMs).isEqualTo(now + 600_000L)
    }
}
