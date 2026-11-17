// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.app.Application
import android.content.Intent
import android.net.Uri
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.plainphone.app.MainActivity
import org.plainphone.app.MaintenancePin
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.FakeSyncApi
import org.plainphone.app.sync.FakeSyncDevice
import org.plainphone.app.sync.RulesResult
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.sync.SyncStore
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class LightEnrollmentTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val sync = SyncStore(context, FakeSecretBox())
    private val config = ConfigStore(context)
    private val token = "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg"
    private val pin = "123456"
    private val origin = "https://pp.example.org"

    private fun link(server: String = origin, enrollmentToken: String = token): Uri = Uri.Builder()
        .scheme("plainphone")
        .authority("setup")
        .appendQueryParameter("token", enrollmentToken)
        .appendQueryParameter("server", server)
        .build()

    private fun confirm(uri: Uri?, enteredPin: String, repeatedPin: String = enteredPin): Boolean =
        LightEnrollment.parse(uri)?.let { LightEnrollment.accept(context, it, enteredPin, repeatedPin, sync) } ?: false

    @Test
    fun `hash the parent PIN locally and leave pairing pending`() {
        confirm(link(), pin)

        assertThat(MaintenancePin.verify(pin, config.load())).isTrue()
        assertThat(config.load().pinSaltHex).matches("[0-9a-f]{32}")
        assertThat(config.load().serverUrl).isEqualTo(origin)
        assertThat(LightSetup.next(context)).isNotEqualTo(LightSetup.Step.PIN)
        assertThat(sync.enrollToken()).isEqualTo(token)
        assertThat(sync.isPaired).isFalse()
    }

    @Test
    fun `pairing without the first rules is not ready to finish setup`() {
        sync.savePaired("test-phone", "test-device-token")
        val api = FakeSyncApi().apply { failRules = IOException("offline") }
        val runner = SyncRunner(sync, api, FakeSyncDevice())

        assertThat(runner.run("initial light setup")).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(LightSetup.hasDashboardRules(sync)).isFalse()

        api.failRules = null
        api.rules = RulesResult.Changed("first-rules", rulesJson())
        assertThat(runner.run("retry")).isInstanceOf(SyncRunner.Outcome.Synced::class.java)
        assertThat(LightSetup.hasDashboardRules(sync)).isTrue()
    }

    @Test
    fun `invalid origin or token cannot set the PIN`() {
        confirm(link(server = "http://example.org"), pin)
        confirm(link(server = "https://example.org/api"), pin)
        confirm(link(enrollmentToken = "123456"), pin)

        assertThat(config.load().usesDefaultPin).isTrue()
        assertThat(sync.enrollToken()).isNull()
    }

    @Test
    fun `unconfirmed links cannot stage enrollment and paired phones reject links`() {
        assertThat(confirm(link(), "654321", pin)).isFalse()
        assertThat(confirm(link(), "12345")).isFalse()
        assertThat(config.load().usesDefaultPin).isTrue()
        assertThat(sync.enrollToken()).isNull()

        sync.savePaired("test-phone", "test-device-token")
        assertThat(confirm(link(), pin)).isFalse()
        assertThat(config.load().usesDefaultPin).isTrue()
        assertThat(sync.enrollToken()).isNull()
    }

    @Test
    fun `browser intent resolves to the exported setup entry point and carries the dashboard values`() {
        val encoded = checkNotNull(javaClass.getResource("/light-setup-intent.txt")).readText().trim()
        val intent = Intent.parseUri(encoded, Intent.URI_INTENT_SCHEME).addCategory(Intent.CATEGORY_BROWSABLE)
        val activity = context.packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY)?.activityInfo

        assertThat(activity?.name).isEqualTo(MainActivity::class.java.name)
        assertThat(activity?.exported).isTrue()
        Robolectric.buildActivity(MainActivity::class.java, intent).create().use { controller ->
            val next = shadowOf(controller.get()).nextStartedActivity
            assertThat(next.component?.className).isEqualTo(LightSetupActivity::class.java.name)
            assertThat(config.load().usesDefaultPin).isTrue()
            assertThat(sync.enrollToken()).isNull()
            assertThat(LightEnrollment.parse(next.data)?.server).isEqualTo(origin)
            assertThat(confirm(next.data, pin)).isTrue()
        }
        assertThat(sync.enrollToken()).isEqualTo(token)
        assertThat(MaintenancePin.verify(pin, config.load())).isTrue()
        assertThat(config.load().pinSaltHex).matches("[0-9a-f]{32}")
    }

    @Test
    fun `continuing without extras skips only optional permissions`() {
        LightSetup.skipOptions(context)

        assertThat(LightSetup.Step.entries.filter { LightSetup.isSkipped(context, it) })
            .containsExactly(LightSetup.Step.RUNNING, LightSetup.Step.LOCATION, LightSetup.Step.ALWAYS_ON)
    }

    @Test
    fun `the parent can replace an unused or refused token and choose a new PIN`() {
        LightSetup.savePin(context, "987654")
        assertThat(confirm(link(), pin)).isTrue()

        val renewed = "pp_e_AAAAAAAAAAAAAAAAAAAAAA"
        val replacementPin = "654321"
        assertThat(confirm(link(enrollmentToken = renewed), replacementPin, pin)).isFalse()
        assertThat(sync.enrollToken()).isEqualTo(token)
        assertThat(MaintenancePin.verify(pin, config.load())).isTrue()

        assertThat(confirm(link(enrollmentToken = renewed), replacementPin)).isTrue()
        assertThat(sync.enrollToken()).isEqualTo(renewed)
        assertThat(MaintenancePin.verify(replacementPin, config.load())).isTrue()
        assertThat(MaintenancePin.verify(pin, config.load())).isFalse()

        sync.saveEnrollToken(null)
        assertThat(confirm(link(), pin)).isTrue()
        assertThat(sync.enrollToken()).isEqualTo(token)
        assertThat(MaintenancePin.verify(pin, config.load())).isTrue()
    }
}
