// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.requests

import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.unit.Density
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Renders the requests screen and the parent PIN box with Robolectric's native graphics and writes PNGs to
 * `app/build/screenshots/requests-*.png` (light, dark, large text, Danish). The checks make sure that
 * "A parent is here: approve with PIN" is only offered on a waiting request, and that the PIN box works.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "en-w393dp-h852dp-xxhdpi")
class RequestsScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private val rows = listOf(
        RequestRow("waiting", PhoneRequest.Kind.APP, "Spotify", RowState.WAITING),
        RequestRow("contact", PhoneRequest.Kind.CONTACT, "Gran (+45 12 34 56 78)", RowState.SENDING),
        RequestRow("phone", PhoneRequest.Kind.APP, "Maps", RowState.APPROVED_ON_PHONE),
        RequestRow("parent", PhoneRequest.Kind.APP, "DR LYD", RowState.APPROVED),
        RequestRow("no", PhoneRequest.Kind.APP, "Instagram", RowState.DECLINED),
    )

    private fun show(ui: RequestsUi, actions: RequestsActions = RequestsActions(), fontScale: Float = 1f) {
        compose.setContent {
            val d = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(d.density, fontScale)) {
                PlainphoneTheme {
                    // A dialog's window never goes idle under Robolectric: show the PIN form inline.
                    if (ui.pin != null) androidx.compose.material3.Surface(color = androidx.compose.material3.MaterialTheme.colorScheme.surface) { PinForm(ui.pin, actions) } else RequestsScreen(ui, actions)
                }
            }
        }
    }

    private fun settle() = Unit

    private fun save(name: String) {
        val bmp = compose.onRoot().captureToImage().asAndroidBitmap()
        write(name, bmp)
    }

    private fun write(name: String, bmp: Bitmap) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }

    @Test
    fun `light, the list`() {
        show(RequestsUi(rows))
        compose.onNodeWithText("Spotify").assertIsDisplayed()
        compose.onNodeWithTag("parent-here-waiting").assertIsDisplayed()
        save("requests-light-list")
    }

    @Test
    @Config(qualifiers = "+night")
    fun `dark, the list`() {
        show(RequestsUi(rows))
        compose.onNodeWithTag("parent-here-waiting").assertIsDisplayed()
        save("requests-dark-list")
    }

    @Test
    fun `large text keeps the action and the back button reachable`() {
        show(RequestsUi(rows.take(2)), fontScale = 1.6f)
        compose.onNodeWithTag("parent-here-waiting").assertIsDisplayed()
        compose.onNodeWithText("Back").assertIsDisplayed()
        save("requests-light-large-text")
    }

    @Test
    fun `only a waiting request offers approval with the PIN`() {
        show(RequestsUi(rows))
        for (id in listOf("contact", "phone", "parent", "no")) {
            compose.onAllNodesWithTagCount("parent-here-$id").let { assertThat(it).isEqualTo(0) }
        }
        assertThat(compose.onAllNodesWithTagCount("parent-here-waiting")).isEqualTo(1)
    }

    @Test
    fun `when the parent switched it off, nothing offers approval with the PIN`() {
        show(RequestsUi(rows, pinApproval = false))
        assertThat(compose.onAllNodesWithTagCount("parent-here-waiting")).isEqualTo(0)
        compose.onNodeWithText("Spotify").assertIsDisplayed()
    }

    @Test
    fun `an empty list says what will show here`() {
        show(RequestsUi(emptyList()))
        compose.onNodeWithText("Nothing is waiting. When you ask for an app or a contact, it shows here.").assertIsDisplayed()
        save("requests-light-empty")
    }

    @Test
    fun `a failed load offers to try again`() {
        var retried = false
        show(RequestsUi(emptyList(), failed = true), RequestsActions(retry = { retried = true }))
        compose.onNodeWithText("Try again").performClick()
        assertThat(retried).isTrue()
    }

    @Test
    fun `tapping the parent button asks for that request`() {
        var asked: String? = null
        show(RequestsUi(rows), RequestsActions(parentIsHere = { asked = it }))
        compose.onNodeWithTag("parent-here-waiting").performClick()
        assertThat(asked).isEqualTo("waiting")
    }

    @Test
    fun `the PIN box sends what is typed and clears it`() {
        var sent: String? = null
        show(RequestsUi(rows, pin = PinDialog("waiting")), RequestsActions(submitPin = { sent = it }))
        settle()
        compose.onNodeWithTag("pin-approve").assertIsNotEnabled()
        compose.onNodeWithTag("pin-field").performTextInput("482913")
        compose.onNodeWithTag("pin-approve").assertIsEnabled()
        compose.onNodeWithTag("pin-approve").performClick()
        assertThat(sent).isEqualTo("482913")
        compose.onNodeWithTag("pin-approve").assertIsNotEnabled()
    }

    @Test
    fun `the PIN box shows a wrong PIN and cannot be used while it is working`() {
        show(RequestsUi(rows, pin = PinDialog("waiting", message = "That PIN is not right.")))
        settle()
        compose.onNodeWithTag("pin-message").assertIsDisplayed()
        write("requests-light-pin-wrong", compose.onRoot().captureToImage().asAndroidBitmap())
    }

    @Test
    fun `while a PIN is being checked the box is locked`() {
        show(RequestsUi(rows, pin = PinDialog("waiting", busy = true)))
        settle()
        compose.onNodeWithTag("pin-approve").assertIsNotEnabled()
        compose.onNodeWithTag("pin-cancel").assertIsNotEnabled()
    }

    @Test
    @Config(qualifiers = "+night")
    fun `dark, the PIN box`() {
        show(RequestsUi(rows, pin = PinDialog("waiting")))
        settle()
        compose.onNodeWithTag("pin-field").assertIsDisplayed()
        write("requests-dark-pin", compose.onRoot().captureToImage().asAndroidBitmap())
    }

    @Test
    @Config(qualifiers = "da-w393dp-h852dp-xxhdpi")
    fun `danish, the list`() {
        show(RequestsUi(rows))
        compose.onNodeWithText("Mine ønsker").assertIsDisplayed()
        compose.onNodeWithText("En forælder er her: godkend med pinkode").assertIsDisplayed()
        save("requests-da-list")
    }

    @Test
    fun `an answer after approving is announced`() {
        show(RequestsUi(rows, notice = "Approved. It takes effect within a minute."))
        compose.onNodeWithTag("requests-notice").assertIsDisplayed()
    }

    private fun androidx.compose.ui.test.junit4.ComposeContentTestRule.onAllNodesWithTagCount(tag: String): Int =
        onAllNodes(androidx.compose.ui.test.hasTestTag(tag)).fetchSemanticsNodes().size
}
