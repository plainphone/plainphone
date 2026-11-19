// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.graphics.Bitmap
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.unit.dp
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.io.IOException
import kotlinx.coroutines.runBlocking
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The QR dialog on a Self phone shows what became of the request: waiting, approved, declined,
 * withdrawn, failed or expired. The "before" PNGs render the old body (the code, whatever
 * happened); the "after" PNGs render the new one. Same fixture, viewport and states. PNGs go to
 * `app/build/screenshots/`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class SelfApprovalOutcomeTest {
    @get:Rule
    val compose = createComposeRule()

    private val url = "https://plainphone.example/approvals#code=fixture"
    private val summary = "Instagram: 15 → 30 min a day"

    private fun qualifiers(night: Boolean, danish: Boolean) {
        RuntimeEnvironment.setQualifiers((if (danish) "+da" else "+en") + (if (night) "-night" else "-notnight"))
    }

    @Test
    fun `maps the server's words and keeps waiting on a word it does not know`() {
        assertThat(ApprovalState.fromServer("approved")).isEqualTo(ApprovalState.Approved)
        assertThat(ApprovalState.fromServer("declined")).isEqualTo(ApprovalState.Declined)
        assertThat(ApprovalState.fromServer("cancelled")).isEqualTo(ApprovalState.Cancelled)
        assertThat(ApprovalState.fromServer("failed")).isEqualTo(ApprovalState.Failed)
        assertThat(ApprovalState.fromServer("waiting")).isEqualTo(ApprovalState.Waiting)
        assertThat(ApprovalState.fromServer("something newer")).isEqualTo(ApprovalState.Waiting)
        assertThat(ApprovalState.fromServer(null)).isEqualTo(ApprovalState.Waiting)
        assertThat(ApprovalState.Waiting.settled).isFalse()
        assertThat(ApprovalState.Expired.settled).isTrue()
    }

    @Test
    fun `polls until answered, ignores a network hiccup, and stops at the answer`() = runBlocking {
        var clock = 0L
        var polls = 0
        val state = awaitApprovalState(
            elapsedMs = { clock },
            poll = {
                polls++
                if (polls == 2) throw IOException("offline")
                if (polls < 4) ApprovalState.Waiting else ApprovalState.Declined
            },
            sleep = { clock += it },
        )
        assertThat(state).isEqualTo(ApprovalState.Declined)
        assertThat(polls).isEqualTo(4)
        assertThat(clock).isEqualTo(4 * APPROVAL_POLL_MS)
    }

    @Test
    fun `gives up when the two minutes are over`() = runBlocking {
        var clock = 0L
        val state = awaitApprovalState(elapsedMs = { clock }, poll = { ApprovalState.Waiting }, sleep = { clock += it })
        assertThat(state).isEqualTo(ApprovalState.Expired)
        assertThat(clock).isAtLeast(APPROVAL_CODE_LIFETIME_MS)
    }

    /** Old and new body of the dialog for one state, each captured on its own with the same viewport. */
    private fun scenario(state: ApprovalState, label: String, night: Boolean, danish: Boolean = false) {
        qualifiers(night, danish)
        compose.setContent {
            PlainphoneTheme {
                Surface(color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.padding(24.dp)) {
                        Column(Modifier.testTag("before")) { SelfApprovalQr(url, summary) }
                        Column(Modifier.padding(top = 24.dp).testTag("after")) {
                            SelfApprovalBody(if (state.settled) null else url, summary, state)
                        }
                    }
                }
            }
        }
        val mode = (if (night) "dark" else "light") + (if (danish) "-da" else "")
        shootNode("before", "approval-qr-before-$label-$mode")
        shootNode("after", "approval-qr-after-$label-$mode")
    }

    private fun shootNode(tag: String, name: String) {
        val bmp = compose.onNodeWithTag(tag).captureToImage().asAndroidBitmap()
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun `waiting, light`() = scenario(ApprovalState.Waiting, "waiting", night = false)
    @Test fun `waiting, dark`() = scenario(ApprovalState.Waiting, "waiting", night = true)
    @Test fun `approved, light`() = scenario(ApprovalState.Approved, "approved", night = false)
    @Test fun `approved, dark`() = scenario(ApprovalState.Approved, "approved", night = true)
    @Test fun `declined, light`() = scenario(ApprovalState.Declined, "declined", night = false)
    @Test fun `declined, dark`() = scenario(ApprovalState.Declined, "declined", night = true)
    @Test fun `expired, light`() = scenario(ApprovalState.Expired, "expired", night = false)
    @Test fun `expired, dark`() = scenario(ApprovalState.Expired, "expired", night = true)
    @Test fun `approved in Danish`() = scenario(ApprovalState.Approved, "approved", night = false, danish = true)

    @Test
    fun `shows the result instead of the code`() {
        compose.setContent { PlainphoneTheme { SelfApprovalBody(null, summary, ApprovalState.Approved) } }
        compose.onNodeWithText("Approved. The new rule reaches this phone in a moment.").assertIsDisplayed()
        compose.onNodeWithText(summary).assertIsDisplayed()
    }

    @Test
    fun `says expired in Danish`() {
        qualifiers(night = false, danish = true)
        compose.setContent { PlainphoneTheme { SelfApprovalBody(null, summary, ApprovalState.Expired) } }
        compose.onNodeWithText("Koden er udløbet. Luk dette, og vælg anmodningen igen for at få en ny kode.").assertIsDisplayed()
    }
}
