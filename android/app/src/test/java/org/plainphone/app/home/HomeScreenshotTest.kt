// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.unit.Density
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.time.LocalTime
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the home screen with Robolectric's native graphics and writes PNGs to
 * `app/build/screenshots/` (light, dark, grid, large text, Danish). The checks make sure the
 * phone and SOS are always on screen, also with large text.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class HomeScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private fun app(label: String, minutes: Int? = null) = HomeApp("pkg.$label", label, "pkg.$label/.Main", minutes)

    private val favourites = listOf(app("Maps"), app("Spotify", 25), app("DR LYD"), app("Rejseplanen"))
    private val all = favourites + listOf(app("Aula"), app("Camera"), app("Clock"), app("MitID"), app("MobilePay"), app("Settings"))

    private fun ui(
        prefs: HomePrefs = HomePrefs.DEFAULT,
        notice: WindowNotice? = null,
        time: String = "07:45",
        date: String = "Tuesday 17 November",
        offer: Boolean = false,
    ) = HomeUi(
        HomeState(prefs, favourites, all, notice),
        time = time,
        date = date,
        noticeUntil = notice?.until?.toString(),
        offerDefaultHome = offer,
    )

    private fun shoot(
        name: String,
        ui: HomeUi,
        palette: HomePalette,
        dark: Boolean,
        fontScale: Float = 1f,
        showAll: Boolean = false,
    ) {
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
                HomeTheme(homeColors(palette, dark)) {
                    HomeScreen(ui, showAll, onShowAll = {}, actions = HomeActions())
                }
            }
        }
        compose.onNodeWithText(if (showAll) "All apps" else "SOS", useUnmergedTree = true).assertIsDisplayed()
        if (!showAll) compose.onNodeWithText("Phone", useUnmergedTree = true).assertIsDisplayed()
        save(name, compose.onRoot().captureToImage().asAndroidBitmap())
    }

    private fun save(name: String, bmp: Bitmap) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }

    @Test
    fun `light, list, graphite (the default)`() = shoot("home-light-list", ui(), HomePalette.GREY, dark = false)

    @Test
    fun `light, list, sage`() = shoot("home-light-list-sage", ui(), HomePalette.SAGE, dark = false)

    @Test
    fun `dark, list, school time`() = shoot(
        "home-dark-school",
        ui(notice = WindowNotice(WindowNotice.Kind.SCHOOL, LocalTime.of(14, 0)), time = "10:20"),
        HomePalette.GREY,
        dark = true,
    )

    @Test
    fun `light, grid, sand`() = shoot("home-light-grid-sand", ui(HomePrefs(layout = HomeLayout.GRID, palette = HomePalette.SAND)), HomePalette.SAND, dark = false)

    @Test
    fun `dark, grid, grey`() = shoot("home-dark-grid-grey", ui(HomePrefs(layout = HomeLayout.GRID, palette = HomePalette.GREY)), HomePalette.GREY, dark = true)

    @Test
    fun `large text keeps phone and SOS on screen`() =
        shoot("home-light-large-text", ui(), HomePalette.GREY, dark = false, fontScale = 1.6f)

    @Test
    fun `large text, dark`() = shoot("home-dark-large-text", ui(), HomePalette.GREY, dark = true, fontScale = 1.6f)

    @Test
    fun `light mode offers to become the home screen`() =
        shoot("home-light-offer", ui(offer = true), HomePalette.GREY, dark = false)

    @Test
    fun `all apps, light`() = shoot("home-all-apps-light", ui(), HomePalette.GREY, dark = false, showAll = true)

    @Test
    fun `all apps, dark`() = shoot("home-all-apps-dark", ui(), HomePalette.SAND, dark = true, showAll = true)

    @Test
    @Config(sdk = [35], qualifiers = "da-w393dp-h852dp-xxhdpi")
    fun `danish, bedtime`() {
        compose.setContent {
            HomeTheme(homeColors(HomePalette.GREY, dark = true)) {
                HomeScreen(
                    ui(notice = WindowNotice(WindowNotice.Kind.BEDTIME, LocalTime.of(7, 0)), time = "21:40", date = "Tirsdag 17. november"),
                    showAll = false,
                    onShowAll = {},
                    actions = HomeActions(),
                )
            }
        }
        compose.onNodeWithText("SOS", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Sengetid til 07:00", useUnmergedTree = true).assertIsDisplayed()
        save("home-da-bedtime", compose.onRoot().captureToImage().asAndroidBitmap())
    }

    @Test
    fun `tapping an app, the phone and SOS reaches the actions`() {
        val opened = mutableListOf<String>()
        compose.setContent {
            HomeTheme(homeColors(HomePalette.GREY, dark = false)) {
                HomeScreen(
                    ui(),
                    showAll = false,
                    onShowAll = {},
                    actions = HomeActions(
                        open = { opened += it.label },
                        phone = { opened += "phone" },
                        sos = { opened += "sos" },
                    ),
                )
            }
        }
        compose.onNodeWithText("Spotify").performClick()
        compose.onNodeWithText("Phone").performClick()
        compose.onNodeWithText("SOS").performClick()
        assertThat(opened).containsExactly("Spotify", "phone", "sos").inOrder()
    }
}
