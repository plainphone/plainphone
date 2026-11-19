// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LightFilterTest {
    private val host = "client.dns.example.org"

    @Test fun diagnosesStrictDnsSettings() {
        assertNull(LightFilter.issue("hostname", host.uppercase(), host))
        assertEquals("wrongHost", LightFilter.issue("hostname", "another.example.org", host))
        assertEquals("off", LightFilter.issue("off", host, host))
        assertEquals("automatic", LightFilter.issue("opportunistic", host, host))
        assertEquals("automatic", LightFilter.issue(null, null, host))
        assertEquals("waiting", LightFilter.issue("hostname", host, null))
    }

    @Test fun keepsTheAlwaysOnTunnelDuringHandoff() {
        assertFalse(LightFilter.shouldStopVpn(FilterMethod.PRIVATE_DNS, alwaysOn = true, lockdown = true))
        assertFalse(LightFilter.shouldStopVpn(FilterMethod.PRIVATE_DNS, alwaysOn = true, lockdown = false))
        assertFalse(LightFilter.shouldStopVpn(FilterMethod.PRIVATE_DNS, alwaysOn = false, lockdown = true))
        assertTrue(LightFilter.shouldStopVpn(FilterMethod.PRIVATE_DNS, alwaysOn = false, lockdown = false))
        assertFalse(LightFilter.shouldStopVpn(FilterMethod.VPN, alwaysOn = false, lockdown = false))
    }

    @Test fun strictDnsPreventsVpnHealthEvenWithTheOldPlainphoneHost() {
        assertFalse(LightFilter.vpnPrivateDnsOk("hostname", host))
        assertTrue(LightFilter.vpnPrivateDnsOk("opportunistic", null))
        assertTrue(LightFilter.vpnPrivateDnsOk("off", null))
        assertFalse(LightFilter.vpnPrivateDnsOk(null, host))
    }

    @Test fun requiresTheDistinctiveCanaryAnswer() {
        assertTrue(LightFilter.canaryMatches(0, listOf("192.0.2.42")))
        assertFalse(LightFilter.canaryMatches(3, listOf("192.0.2.42")))
        assertFalse(LightFilter.canaryMatches(0, emptyList()))
        assertFalse(LightFilter.canaryMatches(0, listOf("192.0.2.43")))
    }

    @Test fun protectsTheEditorAndLeavesTheOverviewAndOtherVpnUsable() {
        val words = SettingsGuard.Keywords(emptyList(), "Plainphone", SettingsGuard.Keywords.BUILT_IN)
        val settings = "com.android.settings"
        assertFalse(SettingsGuard.isProtectedScreen(settings, listOf("Network & internet", "Private DNS"), words, privateDns = true))
        assertTrue(SettingsGuard.isProtectedScreen(settings, listOf("Private DNS provider hostname"), words, privateDns = true))
        assertTrue(SettingsGuard.isProtectedScreen(settings, listOf("com.android.settings:id/private_dns_hostname"), words, privateDns = true))
        assertFalse(SettingsGuard.isProtectedScreen(settings, listOf("Private DNS provider hostname"), words))
        assertFalse(SettingsGuard.isProtectedScreen(SettingsGuard.VPN_DIALOGS, emptyList(), words, privateDns = true))
        val vpnSettings = listOf("Plainphone", "Always-on VPN", "Block connections without VPN")
        assertFalse(SettingsGuard.isProtectedScreen(settings, vpnSettings, words, privateDns = true))
        assertTrue(SettingsGuard.isProtectedScreen(settings, vpnSettings, words))
    }
}
