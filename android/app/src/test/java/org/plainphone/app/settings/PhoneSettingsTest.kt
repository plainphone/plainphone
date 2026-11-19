// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.settings

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PolicyConfig
import org.plainphone.app.home.HomeLayout
import org.plainphone.app.home.HomePalette
import org.plainphone.app.home.HomePrefs
import org.plainphone.app.home.HomeTheme
import org.plainphone.app.sync.EffectivePolicy
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner

/** The `settings` and `home` objects of the rules document. Robolectric for org.json. */
@RunWith(RobolectricTestRunner::class)
class PhoneSettingsTest {

    private fun withExtra(extra: String) = rulesJson().trimEnd().removeSuffix("}") + ",$extra}"

    @Test
    fun `parses settings and the home screen from the rules document`() {
        val r = ServerRules.parse(
            withExtra(
                """"settings":{"camera":{"mode":"locked","value":"off"},"screenTimeout":{"mode":"preset","value":60},"wifi":{"mode":"locked"}},
                   "home":{"layout":"grid","theme":"dark","palette":"sand","apps":["com.spotify.music","dk.dr.radio"]}""",
            ),
        )
        assertThat(r.settings[SettingKey.CAMERA]).isEqualTo(PhoneSetting(Mode.LOCKED, "off"))
        assertThat(r.settings[SettingKey.SCREEN_TIMEOUT]).isEqualTo(PhoneSetting(Mode.PRESET, "60"))
        assertThat(r.settings[SettingKey.WIFI]).isEqualTo(PhoneSetting(Mode.LOCKED))
        assertThat(r.settings[SettingKey.BLUETOOTH].mode).isEqualTo(Mode.FREE)
        assertThat(r.home).isEqualTo(HomePrefs(HomeLayout.GRID, HomeTheme.DARK, HomePalette.SAND, listOf("com.spotify.music", "dk.dr.radio")))
    }

    @Test
    fun `an older server without the fields gives free settings and the default home screen`() {
        val r = ServerRules.parse(rulesJson())
        assertThat(r.settings).isEqualTo(PhoneSettings.NONE)
        assertThat(r.home).isEqualTo(HomePrefs.DEFAULT)
    }

    @Test
    fun `odd settings are skipped one by one, never the whole document`() {
        val s = PhoneSettings.parse(
            JSONObject(
                """{"camera":{"mode":"preset","value":"off"},
                    "teleport":{"mode":"locked"},
                    "screenTimeout":{"mode":"locked","value":45},
                    "brightness":{"mode":"locked","value":"auto"},
                    "volume":{"mode":"locked","value":50},
                    "nfc":{"mode":"locked","value":"off"},
                    "roaming":"locked"}""",
            ),
        )
        // camera has no preset; 45 s is not an offered timeout; locked volume means muted; roaming is not an object.
        assertThat(s.values.keys).containsExactly(SettingKey.BRIGHTNESS, SettingKey.NFC)
    }

    @Test
    fun `free promise is shown for older rules and can be hidden and shown again`() {
        assertThat(ServerRules.parse(rulesJson()).home.showFreePromise).isTrue()
        assertThat(ServerRules.parse(withExtra(""""home":{"layout":"grid"}""")).home.showFreePromise).isTrue()
        assertThat(ServerRules.parse(withExtra(""""home":{"showFreePromise":false}""")).home.showFreePromise).isFalse()
        assertThat(ServerRules.parse(withExtra(""""home":{"showFreePromise":true}""")).home.showFreePromise).isTrue()
    }

    @Test
    fun `the home screen keeps at most eight distinct apps and falls back on unknown values`() {
        val apps = (1..10).joinToString(",") { "\"a.b$it\"" }
        val h = HomePrefs.parse(JSONObject("""{"layout":"spiral","theme":"neon","apps":["a.b1",$apps]}"""))
        assertThat(h.apps).hasSize(HomePrefs.MAX_APPS)
        assertThat(h.apps.first()).isEqualTo("a.b1")
        assertThat(h.layout).isEqualTo(HomeLayout.LIST)
        assertThat(h.theme).isEqualTo(HomeTheme.SYSTEM)
    }

    @Test
    fun `a changed setting changes the lock fingerprint, so the phone re-applies`() {
        val qr = PolicyConfig()
        val now = Instant.parse("2027-01-04T10:00:00Z")
        val plain = EffectivePolicy.merge(qr, ServerRules.parse(rulesJson()), now)
        val camera = EffectivePolicy.merge(qr, ServerRules.parse(withExtra(""""settings":{"camera":{"mode":"locked","value":"off"}}""")), now)
        val home = EffectivePolicy.merge(qr, ServerRules.parse(withExtra(""""home":{"layout":"grid"}""")), now)
        assertThat(EffectivePolicy.fingerprint(camera)).isNotEqualTo(EffectivePolicy.fingerprint(plain))
        // The home screen reads its look itself; it does not need the lock to run again.
        assertThat(EffectivePolicy.fingerprint(home)).isEqualTo(EffectivePolicy.fingerprint(plain))
        assertThat(camera.server?.settings?.isLocked(SettingKey.CAMERA)).isTrue()
    }
}
