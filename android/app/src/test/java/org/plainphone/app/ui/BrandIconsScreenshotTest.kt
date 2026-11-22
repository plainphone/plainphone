// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color as AndroidColor
import android.graphics.drawable.AdaptiveIconDrawable
import android.graphics.drawable.Drawable
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.R
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

/**
 * Brand direction C on the phone: the adaptive launcher icon (also as a themed icon) and the
 * notification icon in a status bar and a notification, light and dark. PNGs go to
 * `app/build/screenshots/`. Android only reads the alpha of a notification icon, so the check
 * fails if the icon has colour in it (the old full-colour tile showed as a white square).
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h600dp-xxhdpi")
class BrandIconsScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    private val context get() = RuntimeEnvironment.getApplication()

    private fun bitmap(drawable: Drawable, px: Int): Bitmap =
        Bitmap.createBitmap(px, px, Bitmap.Config.ARGB_8888).also {
            drawable.setBounds(0, 0, px, px)
            drawable.draw(Canvas(it))
        }

    private fun save(name: String, bmp: Bitmap) {
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use { bmp.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test
    fun `the notification icon is a white silhouette`() {
        val bmp = bitmap(context.getDrawable(R.drawable.ic_notification)!!, 96)
        var opaque = 0
        for (x in 0 until bmp.width) for (y in 0 until bmp.height) {
            val p = bmp.getPixel(x, y)
            if (AndroidColor.alpha(p) == 0) continue
            opaque++
            assertWithMessage("pixel %s,%s", x, y).that(AndroidColor.red(p) + AndroidColor.green(p) + AndroidColor.blue(p))
                .isAtLeast(3 * 250)
        }
        // A silhouette, not a filled square: well under half the canvas is drawn.
        assertThat(opaque).isGreaterThan(0)
        assertThat(opaque).isLessThan(bmp.width * bmp.height / 2)
    }

    @Test
    fun `the launcher icon is adaptive with a themed layer`() {
        val icon = context.getDrawable(R.mipmap.ic_launcher)
        assertThat(icon).isInstanceOf(AdaptiveIconDrawable::class.java)
        assertThat((icon as AdaptiveIconDrawable).monochrome).isNotNull()
    }

    @Test
    fun `icons on the phone, light and dark`() {
        val launcher = bitmap(context.getDrawable(R.mipmap.ic_launcher)!!, 192).asImageBitmap()
        val themed = bitmap(context.getDrawable(R.drawable.ic_launcher_monochrome)!!.mutate().apply { setTint(0xFF3A4A1A.toInt()) }, 192)
            .asImageBitmap()
        compose.setContent { PlainphoneTheme {
            Column(Modifier.fillMaxWidth()) {
                for (dark in listOf(false, true)) {
                    val t = if (dark) PlainTokens.Dark else PlainTokens.Light
                    val shade = if (dark) Color(0xFF1E1E1E) else Color(0xFFF1F1F1)
                    val onShade = if (dark) Color.White else Color(0xFF1F1F1F)
                    Column(Modifier.fillMaxWidth().background(t.paper).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        // Status bar: the system draws the icon in one colour.
                        Row(Modifier.fillMaxWidth().background(shade).padding(horizontal = 12.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                            Text("14.32", color = onShade, style = MaterialTheme.typography.labelLarge)
                            Spacer(Modifier.width(8.dp))
                            Icon(painterResource(R.drawable.ic_notification), contentDescription = null, tint = onShade, modifier = Modifier.size(16.dp))
                        }
                        // A notification in the shade.
                        Row(
                            Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(shade).padding(12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                painterResource(R.drawable.ic_notification), contentDescription = null, tint = Color.White,
                                modifier = Modifier.size(32.dp).clip(CircleShape).background(Color(0xFF141414)).padding(6.dp),
                            )
                            Spacer(Modifier.width(12.dp))
                            Column {
                                Text("Plainphone", color = onShade, style = MaterialTheme.typography.labelLarge)
                                Text("Sam Demo calls", color = onShade, style = MaterialTheme.typography.bodyMedium)
                            }
                        }
                        // Home screen: the adaptive icon and the themed icon (Android 13+).
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                            Image(launcher, contentDescription = null, modifier = Modifier.size(64.dp).clip(CircleShape))
                            Image(launcher, contentDescription = null, modifier = Modifier.size(64.dp).clip(RoundedCornerShape(16.dp)))
                            Image(
                                themed, contentDescription = null,
                                modifier = Modifier.size(64.dp).clip(CircleShape).background(Color(0xFFE2EAC8)),
                            )
                        }
                    }
                }
            }
        }
        }
        save("brand-icons", compose.onRoot().captureToImage().asAndroidBitmap())
    }

    /** The call button is ink with a paper glyph in both themes: signal green is never a call button. */
    private fun keypad(name: String, night: Boolean) {
        RuntimeEnvironment.setQualifiers(if (night) "+night" else "+notnight")
        compose.setContent {
            PlainphoneTheme {
                Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.background)) { KeypadScreen(initial = "112", onCall = {}) }
            }
        }
        save(name, compose.onRoot().captureToImage().asAndroidBitmap())
    }

    @Test
    @Config(qualifiers = "w393dp-h852dp-xxhdpi")
    fun `keypad, light`() = keypad("keypad-light", night = false)

    @Test
    @Config(qualifiers = "w393dp-h852dp-xxhdpi")
    fun `keypad, dark`() = keypad("keypad-dark", night = true)
}
