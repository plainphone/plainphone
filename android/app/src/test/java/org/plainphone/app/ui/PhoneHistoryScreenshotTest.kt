// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.graphics.Bitmap
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.Density
import java.io.File
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.telephony.SmsMessage
import org.plainphone.app.telephony.SmsThread
import org.plainphone.app.telephony.SmsThreadKind
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
class PhoneHistoryScreenshotTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun lightEnglish() = showHistory("history-en-light", "+en-notnight", "Read-only", 1f)

    @Test
    fun darkDanishLargeText() = showHistory("history-da-dark", "+da-night", "Kan kun læses", 1.5f)

    private fun showHistory(name: String, qualifiers: String, readOnly: String, fontScale: Float) {
        RuntimeEnvironment.setQualifiers(qualifiers)
        val approved = ApprovedContact("Alex", "+4512345678")
        val rules = ContactRules(enforced = true, contacts = listOf(approved), country = null)
        val now = System.currentTimeMillis()
        val history = listOf(
            SmsThread(approved.number),
            SmsThread("+4523456789"),
            SmsThread("3", SmsThreadKind.MMS),
        ).mapIndexed { index, thread ->
            thread to listOf(SmsMessage(index + 1L, thread.number, "", now, outgoing = false, failed = false, read = true))
        }.toMap()
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, fontScale)) {
                PlainphoneTheme {
                    Surface {
                        ConversationsScreen(rules, history, rememberLazyListState(), false, false, false, {}, {})
                    }
                }
            }
        }
        compose.onNodeWithText("Alex").assertIsDisplayed()
        compose.onNodeWithText("+4523456789").assertIsDisplayed()
        compose.onAllNodes(androidx.compose.ui.test.hasText(readOnly))[0].assertIsDisplayed()
        val dir = File("build/screenshots").apply { mkdirs() }
        File(dir, "$name.png").outputStream().use {
            check(compose.onRoot().captureToImage().asAndroidBitmap().compress(Bitmap.CompressFormat.PNG, 100, it))
        }
    }
}
