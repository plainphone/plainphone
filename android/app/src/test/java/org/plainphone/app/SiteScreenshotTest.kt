// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.graphics.Bitmap
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.Instant
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.LocalTime
import java.util.Locale
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
import org.plainphone.app.home.WindowNotice
import org.plainphone.app.home.homeColors
import org.plainphone.app.light.BlockedActivity
import org.plainphone.app.light.BlockedScreen
import org.plainphone.app.safety.SharingEntry
import org.plainphone.app.safety.SharingScreen
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.time.MoreTime
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.ParameterizedRobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The phone pictures on plainphone.org: the home screen in school time, the stop screen with
 * "Ask for more time", and "What can my parents see?", in the five site languages, light and dark.
 * Fixed fixtures only (a fictional child, fixed dates), so the output does not change from day to day.
 * PNGs land in `app/build/site-screenshots/`; `site/tools/site-screenshots.mjs` turns them into the
 * WebP files the site serves. Run it with `pnpm site:screenshots`.
 */
@RunWith(ParameterizedRobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class SiteScreenshotTest(private val screen: String, private val lang: String, private val dark: Boolean) {
    @get:Rule
    val compose = createComposeRule()

    private class Words(val date: String, val maps: String, val music: String, val camera: String, val clock: String)

    private val words = WORDS.getValue(lang)

    private fun string(id: Int) = RuntimeEnvironment.getApplication().getString(id)

    @Test
    fun capture() {
        RuntimeEnvironment.setQualifiers("+$lang-" + if (dark) "night" else "notnight")
        when (screen) {
            "home" -> home()
            "blocked" -> blocked()
            else -> sharing()
        }
        val bmp = compose.onRoot().captureToImage().asAndroidBitmap()
        val dir = File("build/site-screenshots").apply { mkdirs() }
        File(dir, "$screen-$lang-${if (dark) "dark" else "light"}.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }

    private fun app(label: String, minutes: Int? = null) = HomeApp("pkg.$label", label, "pkg.$label/.Main", minutes)

    private fun home() {
        val apps = listOf(app(words.maps), app(words.music, 25), app(words.camera), app(words.clock))
        val state = HomeState(HomePrefs.DEFAULT, apps, apps, WindowNotice(WindowNotice.Kind.SCHOOL, LocalTime.of(14, 0)))
        compose.setContent {
            HomeTheme(homeColors(HomePalette.GREY, dark)) {
                HomeScreen(HomeUi(state, "10:32", words.date, noticeUntil = "14:00"), showAll = false, onShowAll = {}, actions = HomeActions())
            }
        }
        compose.onNodeWithText("SOS", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText(words.maps, useUnmergedTree = true).assertIsDisplayed()
    }

    private fun blocked() {
        compose.setContent {
            PlainphoneTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    BlockedScreen(
                        BlockedActivity.Reason.TIME_USED_UP,
                        appLabel = words.music,
                        onHome = {},
                        onReachParent = {},
                        onEnterPin = {},
                        ask = MoreTime.Ui.Offer,
                    )
                }
            }
        }
        compose.onNodeWithText(string(R.string.more_time_ask), useUnmergedTree = true).assertIsDisplayed()
    }

    private fun sharing() {
        val stamp = DateTimeFormatter.ofPattern("d MMM HH:mm", Locale.forLanguageTag(lang)).withZone(ZoneOffset.UTC)
        val at = { iso: String -> Instant.parse(iso).toEpochMilli() }
        val log = listOf(
            SharingEntry("find", at("2026-11-17T16:20:00Z"), at("2026-11-17T16:20:00Z"), 1),
            SharingEntry("checkin", at("2026-11-12T19:05:00Z"), at("2026-11-12T19:05:00Z"), 1),
        )
        compose.setContent {
            PlainphoneTheme {
                Surface(color = MaterialTheme.colorScheme.background) {
                    SharingScreen(
                        mode = ServerRules.LOCATION_CHECKIN,
                        alwaysUntilMs = null,
                        log = log,
                        format = { stamp.format(Instant.ofEpochMilli(it)) },
                        onClose = {},
                    )
                }
            }
        }
        compose.onNodeWithText(string(R.string.sharing_title), substring = true, useUnmergedTree = true).assertIsDisplayed()
    }

    companion object {
        private val WORDS = mapOf(
            "en" to Words("Thursday 19 November", "Maps", "Music", "Camera", "Clock"),
            "da" to Words("Torsdag 19. november", "Kort", "Musik", "Kamera", "Ur"),
            "sv" to Words("Torsdag 19 november", "Kartor", "Musik", "Kamera", "Klocka"),
            "nb" to Words("Torsdag 19. november", "Kart", "Musikk", "Kamera", "Klokke"),
            "de" to Words("Donnerstag, 19. November", "Karten", "Musik", "Kamera", "Uhr"),
        )

        @JvmStatic
        @ParameterizedRobolectricTestRunner.Parameters(name = "{0}-{1}-{2}")
        fun cases(): List<Array<Any>> = listOf("home", "blocked", "sharing").flatMap { screen ->
            WORDS.keys.flatMap { lang -> listOf(false, true).map { dark -> arrayOf<Any>(screen, lang, dark) } }
        }
    }
}
