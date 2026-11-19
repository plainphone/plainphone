// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.home

import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.Locale
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [32])
class HomeLocaleTest {
    @Test
    fun `launcher date follows the resource locale on Android 12`() {
        val app = ApplicationProvider.getApplicationContext<Context>()
        val german = Locale.GERMAN
        val context = app.createConfigurationContext(Configuration().apply { setLocale(german) })
        val now = Instant.parse("2026-11-19T12:00:00Z")
        val date = ZonedDateTime.ofInstant(now, ZoneId.systemDefault())
        val previous = Locale.getDefault()
        try {
            Locale.setDefault(Locale.forLanguageTag("da-DK"))
            assertThat(HomeActivity.load(context, now).date).isEqualTo(HomeActivity.dateText(date, german))
        } finally {
            Locale.setDefault(previous)
        }
    }
}
