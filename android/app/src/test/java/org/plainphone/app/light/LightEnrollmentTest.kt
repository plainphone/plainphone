// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.app.Application
import android.net.Uri
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.SyncStore
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LightEnrollmentTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val sync = SyncStore(context, FakeSecretBox())
    private val config = ConfigStore(context)
    private val token = "pp_e_" + "a".repeat(22)
    private val hash = "b".repeat(64)
    private val salt = "c".repeat(32)
    private val origin = "https://example.org"

    private fun link(server: String = origin, pinHash: String = hash): Uri = Uri.Builder()
        .scheme("plainphone")
        .authority("setup")
        .appendQueryParameter("token", token)
        .appendQueryParameter("pinHash", pinHash)
        .appendQueryParameter("pinSalt", salt)
        .appendQueryParameter("server", server)
        .build()

    @Test
    fun `import the dashboard PIN and leave pairing pending`() {
        LightEnrollment.accept(context, link(), sync)

        assertThat(config.load().pinHashHex).isEqualTo(hash)
        assertThat(config.load().pinSaltHex).isEqualTo(salt)
        assertThat(config.load().serverUrl).isEqualTo(origin)
        assertThat(LightSetup.next(context)).isNotEqualTo(LightSetup.Step.PIN)
        assertThat(sync.enrollToken()).isEqualTo(token)
        assertThat(sync.isPaired).isFalse()
    }

    @Test
    fun `invalid origin or hash cannot set the PIN`() {
        LightEnrollment.accept(context, link(server = "http://example.org"), sync)
        LightEnrollment.accept(context, link(server = "https://example.org/api"), sync)
        LightEnrollment.accept(context, link(pinHash = "123456"), sync)

        assertThat(config.load().usesDefaultPin).isTrue()
        assertThat(sync.enrollToken()).isNull()
    }

    @Test
    fun `a link cannot replace a PIN set locally or change an already paired phone`() {
        LightSetup.savePin(context, "123456")
        val original = config.load()
        LightEnrollment.accept(context, link(), sync)
        assertThat(config.load()).isEqualTo(original)

        sync.savePaired("test-phone", "test-device-token")
        LightSetup.markDashboardPin(context)
        LightEnrollment.accept(context, link(), sync)
        assertThat(config.load()).isEqualTo(original)
        assertThat(sync.enrollToken()).isNull()
    }

    @Test
    fun `continuing without extras skips only optional permissions`() {
        LightSetup.skipOptions(context)

        assertThat(LightSetup.Step.entries.filter { LightSetup.isSkipped(context, it) })
            .containsExactly(LightSetup.Step.RUNNING, LightSetup.Step.LOCATION, LightSetup.Step.ALWAYS_ON)
    }

    @Test
    fun `the parent can replace a refused token during setup`() {
        LightEnrollment.accept(context, link(), sync)
        val replacement = "d".repeat(64)
        LightEnrollment.accept(context, link(pinHash = replacement), sync)
        assertThat(config.load().pinHashHex).isEqualTo(hash)

        sync.saveEnrollToken(null)
        LightEnrollment.accept(context, link(pinHash = replacement), sync)
        assertThat(config.load().pinHashHex).isEqualTo(replacement)
        assertThat(sync.enrollToken()).isEqualTo(token)
    }
}
