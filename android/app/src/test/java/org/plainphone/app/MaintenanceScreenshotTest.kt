// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Canvas
import android.os.Looper
import android.os.SystemClock
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import androidx.compose.ui.graphics.toArgb
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import org.robolectric.shadows.ShadowAlertDialog

/**
 * Renders the Maintenance screen with Robolectric's native graphics and writes PNGs to
 * `app/build/screenshots/` (PIN prompt, unlocked actions and the release confirmation, light,
 * dark, large text, Danish). The synthetic PIN is a test value, never a real one.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class MaintenanceScreenshotTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val pin = "471159"

    @Before
    fun preparePhone() {
        shadowOf(context.getSystemService(DevicePolicyManager::class.java)).setActiveAdmin(PlainphoneAdminReceiver.component(context))
        val salt = "0123456789abcdef"
        ConfigStore(context).save(PolicyConfig(pinHashHex = MaintenancePin.hash(pin, salt), pinSaltHex = salt))
    }

    private fun open(fontScale: Float): MaintenanceActivity {
        RuntimeEnvironment.setFontScale(fontScale)
        return Robolectric.buildActivity(MaintenanceActivity::class.java, Intent(context, MaintenanceActivity::class.java)).setup().get()
    }

    private fun column(activity: MaintenanceActivity) =
        activity.findViewById<android.widget.FrameLayout>(android.R.id.content)
            .getChildAt(0).let { (it as ScrollView).getChildAt(0) as LinearLayout }

    private fun unlock(activity: MaintenanceActivity) {
        val fields = column(activity)
        (fields.getChildAt(1) as EditText).setText(pin)
        (fields.getChildAt(2) as Button).performClick()
        val deadline = SystemClock.elapsedRealtime() + 10_000
        while (fields.getChildAt(1) is EditText && SystemClock.elapsedRealtime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(20)
        }
        assertThat(fields.getChildAt(1) is EditText).isFalse()
    }

    private fun shoot(name: String, view: View) {
        val width = view.resources.displayMetrics.widthPixels
        val content = (view as? android.widget.FrameLayout)?.getChildAt(0) as? ScrollView
        val height = content?.getChildAt(0)?.let {
            it.measure(
                View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY),
                View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED),
            )
            it.measuredHeight
        } ?: view.resources.displayMetrics.heightPixels
        val h = maxOf(height, view.resources.displayMetrics.heightPixels)
        view.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(h, View.MeasureSpec.EXACTLY))
        view.layout(0, 0, width, h)
        val bmp = Bitmap.createBitmap(width, h, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        canvas.drawColor(windowBackground(view))
        view.draw(canvas)
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
        assertThat(bmp.width).isGreaterThan(0)
    }

    /** The colour Android paints behind the activity, which the content view alone does not include. */
    private fun windowBackground(view: View): Int {
        val a = view.context.obtainStyledAttributes(intArrayOf(android.R.attr.colorBackground))
        return a.getColor(0, android.graphics.Color.WHITE).also { a.recycle() }
    }

    private fun content(activity: MaintenanceActivity): View = activity.findViewById(android.R.id.content)

    private fun releaseDialog(activity: MaintenanceActivity): AlertDialog {
        val fields = column(activity)
        val release = (0 until fields.childCount).map(fields::getChildAt).filterIsInstance<Button>().last()
        release.performClick()
        shadowOf(Looper.getMainLooper()).idle()
        return ShadowAlertDialog.getLatestAlertDialog()
    }

    private fun shootDialog(name: String, dialog: AlertDialog) {
        val decor = dialog.window!!.decorView
        val width = decor.resources.displayMetrics.widthPixels
        val height = decor.resources.displayMetrics.heightPixels
        decor.measure(View.MeasureSpec.makeMeasureSpec(width, View.MeasureSpec.EXACTLY), View.MeasureSpec.makeMeasureSpec(height, View.MeasureSpec.AT_MOST))
        decor.layout(0, 0, decor.measuredWidth, decor.measuredHeight)
        val bmp = Bitmap.createBitmap(decor.measuredWidth, decor.measuredHeight, Bitmap.Config.ARGB_8888)
        decor.draw(Canvas(bmp))
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test
    @Config(sdk = [35], qualifiers = "w393dp-h852dp-notnight-xxhdpi")
    fun `PIN prompt, light`() = shoot("maintenance-pin-light", content(open(1f)))

    @Test
    @Config(sdk = [35], qualifiers = "w393dp-h852dp-night-xxhdpi")
    fun `PIN prompt, dark`() = shoot("maintenance-pin-dark", content(open(1f)))

    @Test
    @Config(sdk = [35], qualifiers = "w393dp-h852dp-notnight-xxhdpi")
    fun `actions, light`() {
        val activity = open(1f)
        unlock(activity)
        shoot("maintenance-actions-light", content(activity))
    }

    @Test
    @Config(sdk = [35], qualifiers = "w393dp-h852dp-night-xxhdpi")
    fun `actions, dark`() {
        val activity = open(1f)
        unlock(activity)
        shoot("maintenance-actions-dark", content(activity))
    }

    @Test
    @Config(sdk = [35], qualifiers = "w393dp-h852dp-notnight-xxhdpi")
    fun `actions, large text`() {
        val activity = open(1.6f)
        unlock(activity)
        shoot("maintenance-actions-large-text", content(activity))
    }

    @Test
    @Config(sdk = [35], qualifiers = "da-w393dp-h852dp-notnight-xxhdpi")
    fun `actions, danish`() {
        val activity = open(1f)
        unlock(activity)
        shoot("maintenance-actions-da", content(activity))
    }

    @Test
    @Config(sdk = [35], qualifiers = "w393dp-h852dp-notnight-xxhdpi")
    fun `release confirmation, light`() {
        val activity = open(1f)
        unlock(activity)
        val dialog = releaseDialog(activity)
        assertReleaseDialog(dialog)
        shootDialog("maintenance-release-light", dialog)
    }

    @Test
    @Config(sdk = [35], qualifiers = "w393dp-h852dp-night-xxhdpi")
    fun `release confirmation, dark`() {
        val activity = open(1f)
        unlock(activity)
        val dialog = releaseDialog(activity)
        assertReleaseDialog(dialog)
        shootDialog("maintenance-release-dark", dialog)
    }

    @Test
    @Config(sdk = [35], qualifiers = "w393dp-h852dp-notnight-xxhdpi")
    fun `wrong PIN keeps focus in the PIN field`() {
        val activity = open(1f)
        val fields = column(activity)
        val field = fields.getChildAt(1) as EditText
        val message = fields.getChildAt(3) as android.widget.TextView
        field.setText("000000")
        (fields.getChildAt(2) as Button).performClick()
        val deadline = SystemClock.elapsedRealtime() + 10_000
        while (SystemClock.elapsedRealtime() < deadline && message.text.isEmpty()) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(20)
        }
        assertThat(message.text.toString()).isEqualTo(context.getString(R.string.maintenance_wrong_pin))
        assertThat(field.isFocused).isTrue()
    }

    private fun assertReleaseDialog(dialog: AlertDialog) {
        val go = dialog.getButton(AlertDialog.BUTTON_POSITIVE)
        val keep = dialog.getButton(AlertDialog.BUTTON_NEGATIVE)
        assertThat(go.text.toString()).isEqualTo(context.getString(R.string.maintenance_release_light_go))
        assertThat(keep.text.toString()).isEqualTo(context.getString(R.string.maintenance_release_keep))
        val tokens = MaintenanceStyle(context).tokens
        assertThat(go.currentTextColor).isEqualTo(tokens.danger.toArgb())
        assertThat(keep.currentTextColor).isEqualTo(tokens.action.toArgb())
    }
}
