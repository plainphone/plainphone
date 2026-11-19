// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.graphics.Bitmap
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalTime
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.home.HomeActions
import org.plainphone.app.home.HomeApp
import org.plainphone.app.home.HomePalette
import org.plainphone.app.home.HomePrefs
import org.plainphone.app.home.HomeScreen
import org.plainphone.app.home.HomeState
import org.plainphone.app.home.HomeTheme
import org.plainphone.app.home.HomeUi
import org.plainphone.app.home.homeColors
import org.plainphone.app.time.MoreTime
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The stop screen with "Ask for more time" in each state, and the home screen's 5-minute warning,
 * in light, dark and large text. Synthetic fixtures only. PNGs land in `app/build/screenshots/`
 * like the other screenshot tests; each capture also checks that the existing ways out stay on screen.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class AskMoreTimeScreenshotTest(private val name: String, private val variant: String) {
    @get:Rule
    val compose = createComposeRule()

    private val dark get() = variant == "dark"
    private val fontScale get() = if (variant == "large-text") 1.6f else 1f

    @Test
    fun capture() {
        RuntimeEnvironment.setQualifiers(if (dark) "+en-night" else "+en-notnight")
        if (name == "home-warning") return home()
        val state = STATES.getValue(name)
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
                PlainphoneTheme {
                    Surface(color = MaterialTheme.colorScheme.background) {
                        BlockedScreen(
                            BlockedActivity.Reason.TIME_USED_UP, appLabel = "Spotify", onHome = {}, onReachParent = {}, onEnterPin = {},
                            ask = state,
                        )
                    }
                }
            }
        }
        compose.onNodeWithText("Time is up for today").assertExists()
        compose.onNodeWithText("Back to start").assertIsDisplayed()
        compose.onNodeWithText("Call or message a parent").assertExists()
        save("more-time-$name-$variant")
    }

    private fun home() {
        val apps = listOf(HomeApp("pkg.Spotify", "Spotify", "pkg.Spotify/.Main", 4), HomeApp("pkg.Maps", "Maps", "pkg.Maps/.Main"))
        val text = "Less than 5 minutes left in Spotify today"
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
                HomeTheme(homeColors(HomePalette.SAGE, dark)) {
                    HomeScreen(
                        HomeUi(HomeState(HomePrefs.DEFAULT, apps, apps, null), "14:31", "Monday 4 January", limitWarning = text),
                        showAll = false, onShowAll = {}, actions = HomeActions(),
                    )
                }
            }
        }
        compose.onNodeWithText(text, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("SOS", useUnmergedTree = true).assertIsDisplayed()
        save("more-time-home-warning-$variant")
    }

    private fun save(file: String) {
        val bmp = compose.onRoot().captureToImage().asAndroidBitmap()
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$file.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }

    companion object {
        private val STATES = linkedMapOf(
            "offer" to MoreTime.Ui.Offer,
            "composing" to MoreTime.Ui.Composing,
            "saved-offline" to MoreTime.Ui.Saved,
            "waiting" to MoreTime.Ui.Waiting,
            "no-answer-yet" to MoreTime.Ui.NoAnswerYet,
            "approved" to MoreTime.Ui.Approved(LocalTime.of(14, 35).toString()),
            "approved-rest-of-day" to MoreTime.Ui.Approved(null),
            "declined" to MoreTime.Ui.Declined,
            "expired" to MoreTime.Ui.Expired,
            "unavailable" to MoreTime.Ui.Unavailable,
        )

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}")
        fun cases(): List<Array<Any>> = (STATES.keys + "home-warning").flatMap { state ->
            listOf("light", "dark", "large-text").map { arrayOf<Any>(state, it) }
        }
    }
}
