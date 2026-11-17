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
    private val salt = "b".repeat(32)
    private val hash = MaintenancePin.hash(pin, salt)
    private val origin = "https://pp.example.org"

    private fun link(server: String = origin, pinHash: String = hash): Uri = Uri.Builder()
        .scheme("plainphone")
        .authority("setup")
        .appendQueryParameter("token", token)
        .appendQueryParameter("pinHash", pinHash)
        .appendQueryParameter("pinSalt", salt)
        .appendQueryParameter("server", server)
        .build()

    private fun confirm(uri: Uri?, enteredPin: String): Boolean =
        LightEnrollment.parse(uri)?.let { LightEnrollment.accept(context, it, enteredPin, sync) } ?: false

    @Test
    fun `import the dashboard PIN and leave pairing pending`() {
        confirm(link(), pin)

        assertThat(config.load().pinHashHex).isEqualTo(hash)
        assertThat(config.load().pinSaltHex).isEqualTo(salt)
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
    fun `invalid origin or hash cannot set the PIN`() {
        confirm(link(server = "http://example.org"), pin)
        confirm(link(server = "https://example.org/api"), pin)
        confirm(link(pinHash = "123456"), pin)

        assertThat(config.load().usesDefaultPin).isTrue()
        assertThat(sync.enrollToken()).isNull()
    }

    @Test
    fun `dashboard handoff can resume after entering the same PIN locally`() {
        LightSetup.savePin(context, pin)
        val original = config.load()
        val differentPin = "654321"
        assertThat(confirm(link(pinHash = MaintenancePin.hash(differentPin, salt)), differentPin)).isFalse()
        assertThat(config.load()).isEqualTo(original)
        assertThat(sync.enrollToken()).isNull()

        assertThat(confirm(link(), pin)).isTrue()
        assertThat(config.load().pinHashHex).isEqualTo(hash)
        assertThat(sync.enrollToken()).isEqualTo(token)
    }

    @Test
    fun `unconfirmed links cannot stage enrollment and paired phones reject links`() {
        confirm(link(), "654321")
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
        assertThat(config.load().pinHashHex).isEqualTo(hash)
        assertThat(config.load().pinSaltHex).isEqualTo(salt)
    }

    @Test
    fun `continuing without extras skips only optional permissions`() {
        LightSetup.skipOptions(context)

        assertThat(LightSetup.Step.entries.filter { LightSetup.isSkipped(context, it) })
            .containsExactly(LightSetup.Step.RUNNING, LightSetup.Step.LOCATION, LightSetup.Step.ALWAYS_ON)
    }

    @Test
    fun `the parent can replace a refused token during setup`() {
        confirm(link(), pin)
        val newSalt = "d".repeat(32)
        val replacement = MaintenancePin.hash(pin, newSalt)
        val renewed = link(pinHash = replacement).buildUpon().clearQuery()
            .appendQueryParameter("token", token).appendQueryParameter("pinHash", replacement)
            .appendQueryParameter("pinSalt", newSalt).appendQueryParameter("server", origin).build()
        confirm(renewed, pin)
        assertThat(config.load().pinHashHex).isEqualTo(hash)

        sync.saveEnrollToken(null)
        confirm(renewed, pin)
        assertThat(config.load().pinHashHex).isEqualTo(replacement)
        assertThat(sync.enrollToken()).isEqualTo(token)
    }
}
