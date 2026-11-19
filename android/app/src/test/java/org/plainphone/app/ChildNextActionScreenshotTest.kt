// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.util.concurrent.TimeUnit
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ui.PlainphoneTheme
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Before/after captures for UX package 3 (the child's next action): the guard's calm screen, the
 * dialer and Maintenance, light and dark, with synthetic fixtures only. PNGs land in
 * `app/build/screenshots/` and are copied to `docs/screenshots/ux-child-next-action/`.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class ChildNextActionScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private fun shoot(name: String, qualifiers: String, fontScale: Float = 1f, content: @Composable () -> Unit) {
        RuntimeEnvironment.setQualifiers(qualifiers)
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                PlainphoneTheme { content() }
            }
        }
        save(name, compose.onRoot().captureToImage().asAndroidBitmap())
    }

    @Test
    fun guardTimeUsedUpLight() = shoot("guard-time-light", "+en-notnight") { GuardFixture.timeUsedUp() }

    @Test
    fun guardTimeUsedUpDark() = shoot("guard-time-dark", "+en-night") { GuardFixture.timeUsedUp() }

    @Test
    fun guardNotAllowedLight() = shoot("guard-not-allowed-light", "+en-notnight") { GuardFixture.notAllowed() }

    @Test
    fun guardNotAllowedDark() = shoot("guard-not-allowed-dark", "+en-night") { GuardFixture.notAllowed() }

    @Test
    fun guardTimeUsedUpLargeText() = shoot("guard-time-large-text", "+en-notnight", 1.6f) { GuardFixture.timeUsedUp() }

    @Test
    fun dialerLight() = shoot("dialer-light", "+en-notnight") { DialerFixture.keypad() }

    @Test
    fun dialerDark() = shoot("dialer-dark", "+en-night") { DialerFixture.keypad() }

    @Test
    fun dialerLargeTextLight() = shoot("dialer-large-text-light", "+en-notnight", 1.6f) { DialerFixture.keypad() }

    @Test
    fun dialerLargeTextDark() = shoot("dialer-large-text-dark", "+en-night", 1.6f) { DialerFixture.keypad() }

    @Test
    fun maintenanceLight() = maintenance("maintenance-light", "+en-notnight")

    @Test
    fun maintenanceDark() = maintenance("maintenance-dark", "+en-night")

    @Test
    fun maintenanceLiftedLight() = maintenance("maintenance-lifted-light", "+en-notnight", lift = true)

    @Test
    fun maintenanceLiftedDark() = maintenance("maintenance-lifted-dark", "+en-night", lift = true)

    private fun maintenance(name: String, qualifiers: String, lift: Boolean = false) {
        RuntimeEnvironment.setQualifiers(qualifiers)
        val context = ApplicationProvider.getApplicationContext<Context>()
        val admin = PlainphoneAdminReceiver.component(context)
        shadowOf(context.getSystemService(DevicePolicyManager::class.java)).setActiveAdmin(admin)
        val pin = "471159"
        val salt = "0123456789abcdef"
        ConfigStore(context).save(PolicyConfig(pinHashHex = MaintenancePin.hash(pin, salt), pinSaltHex = salt))
        val activity = Robolectric.buildActivity(MaintenanceActivity::class.java, Intent(context, MaintenanceActivity::class.java)).setup().get()
        val column = (activity.findViewById<android.widget.FrameLayout>(android.R.id.content).getChildAt(0) as ScrollView)
            .getChildAt(0) as LinearLayout
        (column.getChildAt(1) as EditText).setText(pin)
        (column.getChildAt(2) as Button).performClick()
        pumpUntil { column.childCount > 4 }
        assertThat(column.childCount).isGreaterThan(4)
        if (lift) {
            findButton(column) { it.text.startsWith("Lift the lock") }.performClick()
            pumpUntil { Lock.isInMaintenanceWindow(context) }
            pumpUntil(millis = 300) { false }
        }
        val view = activity.window.decorView
        val width = view.width.takeIf { it > 0 } ?: 1080
        val height = view.height.takeIf { it > 0 } ?: 2340
        val bmp = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
        view.draw(Canvas(bmp))
        save(name, bmp)
    }

    private fun findButton(column: LinearLayout, match: (Button) -> Boolean): Button =
        (0 until column.childCount).map { column.getChildAt(it) }.filterIsInstance<Button>().first(match)

    private fun pumpUntil(millis: Long = 5_000, done: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(millis)
        while (!done() && System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
        shadowOf(ApplicationProvider.getApplicationContext<Application>().mainLooper).idle()
    }

    private fun save(name: String, bmp: Bitmap) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }
}
