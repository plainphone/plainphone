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
import java.time.Instant
import java.time.LocalTime
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * The home screen at bedtime: the child sees that the phone is silent, and why. Also the link to the
 * requests that wait for a parent. PNGs go to `app/build/screenshots/home-bedtime-*.png`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w393dp-h852dp-xxhdpi")
class HomeBedtimeScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private val bedtime = """[{"id":"b1","kind":"bedtime","days":[1,2,3,4,5,6,7],"start":"21:00","end":"07:00","allowedPackages":[]}]"""
    private val night = Instant.parse("2027-01-04T21:30:00Z") // 22:30 in Copenhagen

    private fun app(label: String) = HomeApp("pkg.$label", label, "pkg.$label/.Main")

    private fun ui(silentBedtime: Boolean = true, requests: Int = 0): HomeUi {
        val extra = if (silentBedtime) "" else "\"silentBedtime\":false,"
        val rules = ServerRules.parse(rulesJson(schedules = bedtime).replace("\"pollSeconds\":60", "$extra\"pollSeconds\":60"))
        val state = HomeModel.build(emptyList(), rules, night)
            .copy(favourites = listOf(app("Maps"), app("Spotify")), all = listOf(app("Maps"), app("Spotify")))
        return HomeUi(state, time = "22:30", date = "Monday 4 January", noticeUntil = state.notice?.until?.toString(), openRequests = requests)
    }

    private fun shoot(name: String, ui: HomeUi, dark: Boolean, fontScale: Float = 1f) {
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
                HomeTheme(homeColors(HomePalette.GREY, dark)) {
                    HomeScreen(ui, showAll = false, onShowAll = {}, actions = HomeActions())
                }
            }
        }
        compose.onNodeWithText("SOS", useUnmergedTree = true).assertIsDisplayed()
        val bmp: Bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }

    @Test
    fun `the model marks bedtime as silent only when the parent kept it on`() {
        assertThat(ui().state.notice).isEqualTo(WindowNotice(WindowNotice.Kind.BEDTIME, LocalTime.of(7, 0), silent = true))
        assertThat(ui(silentBedtime = false).state.notice?.silent).isFalse()
    }

    @Test
    fun `school time is never called silent`() {
        val school = """[{"id":"s1","kind":"school","days":[1,2,3,4,5,6,7],"start":"08:00","end":"15:00","allowedPackages":[]}]"""
        val rules = ServerRules.parse(rulesJson(schedules = school))
        val state = HomeModel.build(emptyList(), rules, Instant.parse("2027-01-05T09:00:00Z"))
        assertThat(state.notice?.silent).isFalse()
    }

    @Test
    fun `light, silent bedtime`() {
        shoot("home-bedtime-light", ui(), dark = false)
        compose.onNodeWithText("Bedtime until 07:00", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("The phone is silent. Only parents and help lines ring.", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("Everyone sleeps better when the phone is quiet at night.", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun `dark, silent bedtime`() = shoot("home-bedtime-dark", ui(), dark = true)

    @Test
    fun `large text, silent bedtime, with a waiting request`() {
        shoot("home-bedtime-large-text", ui(requests = 2), dark = false, fontScale = 1.6f)
        compose.onNodeWithText("The phone is silent. Only parents and help lines ring.", useUnmergedTree = true).assertIsDisplayed()
    }

    @Test
    fun `bedtime that is not silent says only that it is bedtime`() {
        shoot("home-bedtime-not-silent", ui(silentBedtime = false), dark = false)
        compose.onNodeWithText("Bedtime until 07:00", useUnmergedTree = true).assertIsDisplayed()
        assertThat(compose.onAllNodesText("The phone is silent. Only parents and help lines ring.")).isEqualTo(0)
    }

    @Test
    fun `a waiting request has a link that opens the requests`() {
        var opened = false
        compose.setContent {
            HomeTheme(homeColors(HomePalette.GREY, false)) {
                HomeScreen(ui(requests = 2), showAll = false, onShowAll = {}, actions = HomeActions(requests = { opened = true }))
            }
        }
        compose.onNodeWithText("2 requests are waiting for an answer", useUnmergedTree = true).performClick()
        assertThat(opened).isTrue()
    }

    @Test
    fun `no waiting request, no link`() {
        compose.setContent { HomeTheme(homeColors(HomePalette.GREY, false)) { HomeScreen(ui(), false, {}, HomeActions()) } }
        assertThat(compose.onAllNodesText("1 request is waiting for an answer")).isEqualTo(0)
    }

    @Test
    @Config(qualifiers = "da-w393dp-h852dp-xxhdpi")
    fun `danish, silent bedtime`() {
        shoot("home-bedtime-da", ui(requests = 1), dark = true)
        compose.onNodeWithText("Telefonen er stille. Kun forældre og hjælpelinjer ringer.", useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithText("1 ønske venter på svar", useUnmergedTree = true).assertIsDisplayed()
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesText(text: String): Int =
        onAllNodes(androidx.compose.ui.test.hasText(text), useUnmergedTree = true).fetchSemanticsNodes().size
}
