// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import com.google.common.truth.Truth.assertThat
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.DeviceStatus
import org.plainphone.app.sync.LockState
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class) // org.json is Android's
class LightModeTest {
    private val k = SettingsGuard.Keywords(
        ownDescriptions = listOf("Plainphone uses this to see which app is open"),
        appName = "Plainphone",
        dangerous = SettingsGuard.Keywords.BUILT_IN,
    )

    @Test
    fun `the plan blocks what strong mode would hide, plus used-up apps`() {
        val plan = LightPlan.build(
            launchable = setOf("com.dialer", "com.maker.sms", "com.tiktok", "com.spotify", "org.plainphone.app", "com.android.vending"),
            core = setOf("com.dialer", "com.maker.sms"),
            allowed = setOf("com.spotify"),
            ownPackage = "org.plainphone.app",
            telephony = setOf("com.maker.sms"),
            timeBlocked = setOf("com.spotify", "com.dialer"),
            installing = null,
        )
        assertThat(plan.blocked).containsExactly("com.maker.sms", "com.tiktok", "com.android.vending")
        assertThat(plan.timeBlocked).containsExactly("com.spotify") // core apps are never blocked by time
        assertThat(plan.why("com.tiktok")).isEqualTo(LightPlan.Why.NOT_ALLOWED)
        assertThat(plan.why("com.spotify")).isEqualTo(LightPlan.Why.TIME_USED_UP)
        assertThat(plan.why("com.dialer")).isNull()
    }

    @Test
    fun `Play is let through while an approved app is installed`() {
        val plan = LightPlan.build(setOf("com.android.vending"), emptySet(), emptySet(), "org.plainphone.app", emptySet(), emptySet(), "dk.mitid.app.android")
        assertThat(plan.blocked).isEmpty()
    }

    @Test
    fun `Plainphone's own accessibility, admin, VPN and app pages are protected`() {
        assertThat(SettingsGuard.isProtectedScreen("com.android.settings", listOf("Plainphone guard", "Plainphone uses this to see which app is open, so"), k)).isTrue()
        assertThat(SettingsGuard.isProtectedScreen("com.android.settings", listOf("App info", "Plainphone", "Uninstall", "Force stop"), k)).isTrue()
        assertThat(SettingsGuard.isProtectedScreen("com.android.settings", listOf("Plainphone", "Always-on VPN", "Forget VPN"), k)).isTrue()
        assertThat(SettingsGuard.isProtectedScreen("com.android.settings", listOf("Apps", "Plainphone", "Afinstaller"), k)).isTrue()
        assertThat(SettingsGuard.isProtectedScreen("com.google.android.packageinstaller", listOf("Do you want to uninstall Plainphone?"), k)).isTrue()
        assertThat(SettingsGuard.isProtectedScreen(SettingsGuard.VPN_DIALOGS, listOf("Disconnect"), k)).isTrue()
    }

    @Test
    fun `other Settings screens and other apps are left alone`() {
        assertThat(SettingsGuard.isProtectedScreen("com.android.settings", listOf("Wi-Fi", "Bluetooth", "Uninstall updates"), k)).isFalse()
        assertThat(SettingsGuard.isProtectedScreen("com.android.settings", listOf("Display", "Plainphone"), k)).isFalse()
        // Network & internet shows the connected VPN's name; Apps shows Plainphone as recently opened.
        assertThat(SettingsGuard.isProtectedScreen("com.android.settings", listOf("Network & internet", "Wi-Fi", "Mobile network", "VPN", "Plainphone"), k)).isFalse()
        assertThat(SettingsGuard.isProtectedScreen("com.android.settings", listOf("Apps & notifications", "Recently opened apps", "Plainphone", "Default apps"), k)).isFalse()
        // Updating Plainphone from a new APK must not be closed.
        assertThat(SettingsGuard.isProtectedScreen("com.google.android.packageinstaller", listOf("Plainphone", "Do you want to install an update to this existing app?"), k)).isFalse()
        assertThat(SettingsGuard.isProtectedScreen("com.spotify.music", listOf("Plainphone", "Uninstall"), k)).isFalse()
    }

    @Test
    fun `private DNS pointing to another resolver is a hole`() {
        assertThat(Protections.privateDnsOk(null, "x.dns.plainphone.org")).isTrue()
        assertThat(Protections.privateDnsOk("X.dns.plainphone.org", "x.dns.plainphone.org")).isTrue()
        assertThat(Protections.privateDnsOk("dns.google", "x.dns.plainphone.org")).isFalse()
    }

    @Test
    fun `missing protections are named, recommended ones are not required`() {
        val all = Protections(false, true, true, true, true, false, true, true, false, false, true)
        assertThat(all.missingForLight()).isEmpty()
        assertThat(all.copy(vpn = false, accessibility = false).missingForLight())
            .containsExactly("accessibility service", "DNS filter (VPN)").inOrder()
    }

    @Test
    fun `a light-mode lock is intact without Device Owner`() {
        val light = LockState(mode = "light", deviceOwner = false, maintenance = false, failedPolicies = emptyList(), appliedAtMs = 1L, dnsHost = null)
        assertThat(light.intact).isTrue()
        assertThat(light.copy(failedPolicies = listOf("DNS filter (VPN)")).intact).isFalse()
        assertThat(light.copy(mode = "strong").intact).isFalse()
    }

    @Test
    fun `status carries mode, protections and minutes used`() {
        val j = DeviceStatus(
            "0.1.4", 80, false, false, true, false, emptyList(), null, null, null,
            mode = "light", protections = mapOf("vpn" to true), timeUsed = mapOf("*" to 34),
        ).toJson()
        assertThat(j.getString("mode")).isEqualTo("light")
        assertThat(j.getJSONObject("protections").getBoolean("vpn")).isTrue()
        assertThat(j.getJSONObject("timeUsed").getInt("*")).isEqualTo(34)
        val strong = DeviceStatus("0.1.4", 80, false, true, true, false, emptyList(), null, null, null).toJson()
        assertThat(strong.has("protections")).isFalse()
        assertThat(JSONObject(strong.toString()).getString("mode")).isEqualTo("strong")
    }
}
