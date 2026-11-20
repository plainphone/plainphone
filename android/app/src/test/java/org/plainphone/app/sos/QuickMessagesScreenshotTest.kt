// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import android.graphics.Bitmap
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.safety.SharingScreen
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Quick messages on the SOS screen, the sent confirmation for a code word, the suggestion form and
 * "What can my parents see?" with the hidden SOS on; light, dark and large text. Synthetic fixtures
 * only. PNGs land in `app/build/screenshots/`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class QuickMessagesScreenshotTest(private val name: String, private val variant: String) {
    @get:Rule
    val compose = createComposeRule()

    private val items = listOf(
        QuickMessage("a", "Pick me up", meansSos = false),
        QuickMessage("b", "I'm okay", meansSos = false),
        QuickMessage("c", "Call me", meansSos = false),
        QuickMessage("d", "Is the blue bike home?", meansSos = true),
    )

    private fun show(content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers(if (variant == "dark") "+en-night" else "+en-notnight")
        val fontScale = if (variant == "large-text") 1.6f else 1f
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
                PlainphoneTheme { Surface(color = MaterialTheme.colorScheme.surface) { content() } }
            }
        }
    }

    @Test
    fun capture() {
        when (name) {
            "sos-screen" -> sosScreen()
            "code-word-sent" -> codeWordSent()
            "suggest-form" -> suggestForm()
            "suggest-waiting" -> suggestWaiting()
            "sharing-hidden" -> sharing()
        }
        save("quick-$name-$variant")
    }

    private fun sosScreen() {
        val rules = JSONObject(rulesJson())
        val quick = JSONArray()
        items.forEach { quick.put(JSONObject().put("id", it.id).put("text", it.text).put("meansSos", it.meansSos)) }
        rules.put(
            "sos",
            JSONObject().put("name", "Kim").put("parents", rules.getJSONArray("contacts"))
                .put("quickMessages", JSONObject().put("enabled", true).put("suggest", true).put("items", quick)),
        )
        SyncStore(RuntimeEnvironment.getApplication()).saveRules("test", rules.toString(), 1_800_000_000_000L)
        show { SosScreen(onBack = {}, emergency = {}) }
        compose.onNodeWithText("Urgent: I need help now").assertIsDisplayed()
        compose.onNodeWithText("Call 112").assertIsDisplayed()
        compose.onNodeWithText("Quick messages").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Pick me up").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Suggest a quick message").performScrollTo().assertIsDisplayed()
    }

    private fun codeWordSent() {
        val sent = mutableListOf<QuickMessage>()
        show { QuickMessagesPanel(items, suggest = false, onSend = { sent += it; true }, onSuggest = { SuggestResult.SENT }, Modifier.padding(24.dp)) }
        compose.onNodeWithText("Is the blue bike home?").performClick()
        // A code word looks exactly like any message: the same words, and nothing about SOS.
        compose.onNodeWithText("Sent to your parents").assertIsDisplayed()
        assertThat(compose.onAllNodes(hasText("SOS", substring = true)).fetchSemanticsNodes()).isEmpty()
        assertThat(sent.single().meansSos).isTrue()
    }

    private fun suggestForm() {
        show {
            QuickMessagesPanel(
                items.take(3), suggest = true, onSend = { true }, onSuggest = { SuggestResult.SENT },
                Modifier.padding(24.dp), initialSuggestion = "Can we have pizza tonight?",
            )
        }
        compose.onNodeWithText("Your message").assertExists()
        compose.onNodeWithText("Send").assertIsDisplayed()
        compose.onNodeWithText("26/60").assertIsDisplayed()
    }

    private fun suggestWaiting() {
        show {
            QuickMessagesPanel(
                items.take(3), suggest = true, onSend = { true }, onSuggest = { SuggestResult.WAITING },
                Modifier.padding(24.dp), initialSuggestion = "Can we have pizza tonight?",
            )
        }
        compose.onNodeWithText("Send").performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Your parents have not answered your earlier suggestions yet").assertIsDisplayed()
    }

    private fun sharing() {
        show {
            SharingScreen(
                "find", null, emptyList(), { "12:00" },
                hiddenSos = SosSharing(powerPresses = 4, clock = true, codeWords = listOf("Is the blue bike home?"), withPosition = true),
            ) {}
        }
        compose.onNodeWithText("Pressing the power button 4 times quickly sends your parents a silent SOS with your position.")
            .assertExists()
        compose.onNodeWithText("Holding the clock on the home screen sends your parents a silent SOS.").assertExists()
        compose.onNodeWithText("These quick messages also send your parents an SOS: «Is the blue bike home?»").assertExists()
    }

    private fun save(file: String) {
        val bmp = compose.onRoot().captureToImage().asAndroidBitmap()
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$file.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun cases(): List<Array<Any>> = listOf("sos-screen", "code-word-sent", "suggest-form", "suggest-waiting", "sharing-hidden")
            .flatMap { name -> listOf("light", "dark", "large-text").map { arrayOf<Any>(name, it) } }
    }
}
