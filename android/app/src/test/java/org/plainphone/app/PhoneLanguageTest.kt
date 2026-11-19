// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app

import android.app.Application
import android.app.LocaleManager
import android.content.res.Resources
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(application = Application::class)
class PhoneLanguageTest {
    @Test
    @Config(sdk = [33])
    fun `sets and clears the app locale without changing the system locale`() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val manager = app.getSystemService(LocaleManager::class.java)
        val system = manager.systemLocales
        val language = PhoneLanguage(app)

        language.apply("nb")
        assertThat(manager.applicationLocales.toLanguageTags()).isEqualTo("nb")
        assertThat(manager.systemLocales).isEqualTo(system)
        language.apply(null)
        assertThat(manager.applicationLocales.isEmpty).isTrue()
    }

    @Test
    @Config(sdk = [29, 32])
    fun `applies the fallback resources and returns them to the system locale`() {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val system = Resources.getSystem().configuration.locales
        val language = PhoneLanguage(app)

        language.apply("de")
        assertThat(app.resources.configuration.locales.toLanguageTags()).isEqualTo("de")
        assertThat(app.getString(R.string.maintenance_language, "Deutsch")).isEqualTo("Sprache in Plainphone: Deutsch")
        assertThat(Resources.getSystem().configuration.locales).isEqualTo(system)
        language.apply(null)
        assertThat(app.resources.configuration.locales).isEqualTo(system)
    }
}
