// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.graphics.Bitmap
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.R
import org.plainphone.app.safety.SharingScreen
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * What the child sees when an app tries to open Play outside an update window ("play", and
 * "manual" when the parents switched the nightly window off), and the line on "What can my
 * parents see?" ("sharing"), in all five languages, light and dark. Written to
 * `app/build/screenshots/app-updates-*.png`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class PlayExplanationScreenshotTest(private val screen: String, private val lang: String, private val dark: Boolean) {
    @get:Rule val compose = createComposeRule()

    private fun string(id: Int) = RuntimeEnvironment.getApplication().getString(id)

    @Test
    fun capture() {
        RuntimeEnvironment.setQualifiers("+$lang-" + if (dark) "night" else "notnight")
        when (screen) {
            "sharing" -> {
                compose.setContent {
                    PlainphoneTheme {
                        SharingScreen(
                            mode = ServerRules.LOCATION_OFF, alwaysUntilMs = null, log = emptyList(), format = { "" },
                            appUpdates = true, onClose = {},
                        )
                    }
                }
                compose.onNodeWithText(string(R.string.sharing_app_updates)).assertExists()
            }
            else -> {
                val automatic = screen == "play"
                compose.setContent { PlainphoneTheme { PlayExplanationScreen(automatic = automatic, onClose = {}) } }
                compose.onNodeWithText(string(R.string.play_explain_title)).assertIsDisplayed()
                compose.onNodeWithText(string(if (automatic) R.string.play_explain_automatic else R.string.play_explain_manual))
                    .assertIsDisplayed()
                compose.onNodeWithText(string(R.string.play_explain_new_app)).assertIsDisplayed()
            }
        }
        val bmp = compose.onRoot().captureToImage().asAndroidBitmap()
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "app-updates-$screen-$lang-${if (dark) "dark" else "light"}.png").outputStream()
            .use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }

    companion object {
        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}-dark={2}")
        fun cases(): List<Array<Any>> = listOf("play", "manual", "sharing").flatMap { screen ->
            listOf("en", "da", "sv", "nb", "de").flatMap { lang ->
                listOf(false, true).map { dark -> arrayOf<Any>(screen, lang, dark) }
            }
        }
    }
}
