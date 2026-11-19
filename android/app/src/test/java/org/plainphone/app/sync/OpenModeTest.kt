// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.ZoneId
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PolicyConfig
import org.plainphone.app.home.HomeModel
import org.plainphone.app.home.LaunchableApp
import org.plainphone.app.light.LightPlan
import org.robolectric.RobolectricTestRunner

/** Open mode (docs/open-mode.md): allow by default, only the block list is sent home. */
@RunWith(RobolectricTestRunner::class) // org.json is Android's
class OpenModeTest {
    private val qr = PolicyConfig(dnsHost = "family.adguard-dns.com")
    private val noon = Instant.parse("2027-01-04T11:00:00Z")
    private val bedtime = """[{"id":"b1","kind":"bedtime","days":[1,2,3,4,5,6,7],"start":"21:00","end":"07:00","allowedPackages":["com.spotify.music"]}]"""
    private val atNight = Instant.parse("2027-01-04T21:30:00Z")

    private fun open(blocked: String = """["com.instagram.android","com.tiktok"]""", schedules: String = "[]") =
        ServerRules.parse(
            rulesJson(schedules = schedules).replace("\"hidden\":", "\"open\":true,\"blocked\":$blocked,\"hidden\":"),
        )

    @Test
    fun `an older server without the open flag keeps the allow-list`() {
        val old = ServerRules.parse(rulesJson())
        assertThat(old.openApps).isFalse()
        assertThat(old.blockedApps).isEmpty()
        val merged = EffectivePolicy.merge(qr, old, noon)
        assertThat(merged.openBlocked).isNull()
        assertThat(merged.visibleAmong(setOf("com.spotify.music", "com.example.new"))).isEqualTo(merged.allowedPackages)
    }

    @Test
    fun `the open flag and block list are parsed and reach the policy`() {
        val rules = open()
        assertThat(rules.openApps).isTrue()
        assertThat(rules.blockedApps).containsExactly("com.instagram.android", "com.tiktok")
        assertThat(EffectivePolicy.merge(qr, rules, noon).openBlocked).containsExactly("com.instagram.android", "com.tiktok")
    }

    @Test
    fun `everything is visible except the block list, also apps installed after the last sync`() {
        val config = EffectivePolicy.merge(qr, open(), noon)
        val launchable = setOf("com.spotify.music", "com.example.installed.today", "com.instagram.android", "com.tiktok")
        assertThat(config.visibleAmong(launchable)).containsExactly("com.spotify.music", "com.example.installed.today")
    }

    @Test
    fun `the guard sends only the block list home`() {
        val config = EffectivePolicy.merge(qr, open(), noon)
        val launchable = setOf("com.dialer", "com.spotify.music", "com.example.installed.today", "com.instagram.android", "org.plainphone.app")
        val plan = LightPlan.build(
            launchable = launchable,
            core = setOf("com.dialer"),
            allowed = config.visibleAmong(launchable),
            ownPackage = "org.plainphone.app",
            telephony = emptySet(),
            timeBlocked = emptySet(),
            installing = null,
        )
        assertThat(plan.blocked).containsExactly("com.instagram.android")
        assertThat(plan.why("com.example.installed.today")).isNull()
        assertThat(plan.why("com.instagram.android")).isEqualTo(LightPlan.Why.NOT_ALLOWED)
    }

    @Test
    fun `a bedtime window still lists exactly what is allowed`() {
        val rules = open(schedules = bedtime)
        val config = EffectivePolicy.merge(qr, rules, atNight)
        assertThat(config.openBlocked).isNull()
        assertThat(config.allowedPackages).containsExactly("com.spotify.music")
    }

    @Test
    fun `the fingerprint changes when the block list does`() {
        val a = EffectivePolicy.fingerprint(EffectivePolicy.merge(qr, open("""["com.tiktok"]"""), noon))
        val b = EffectivePolicy.fingerprint(EffectivePolicy.merge(qr, open("""["com.tiktok","com.reddit.frontpage"]"""), noon))
        val closed = EffectivePolicy.fingerprint(EffectivePolicy.merge(qr, ServerRules.parse(rulesJson()), noon))
        assertThat(setOf(a, b, closed)).hasSize(3)
    }

    @Test
    fun `the home screen shows every app except the block list`() {
        fun app(pkg: String, label: String) = LaunchableApp(pkg, label, "$pkg/.Main")
        val apps = listOf(app("com.spotify.music", "Spotify"), app("com.example.new", "New"), app("com.tiktok", "TikTok"), app("com.camera", "Camera"))
        val state = HomeModel.build(apps, open(), noon, core = setOf("com.camera"))
        assertThat(state.all.map { it.label }).containsExactly("Camera", "New", "Spotify").inOrder()
        // The window's own list wins at bedtime.
        val night = HomeModel.build(apps, open(schedules = bedtime), atNight, core = setOf("com.camera"))
        assertThat(night.all.map { it.label }).containsExactly("Camera", "Spotify").inOrder()
        assertThat(ServerRules.parse(rulesJson()).timezone).isEqualTo(ZoneId.of("Europe/Copenhagen"))
    }
}
