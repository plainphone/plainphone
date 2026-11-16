// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PolicyApplierTest {
    private val device = FakeDevice(
        launchable = mutableSetOf("com.dialer", "com.sms", "com.camera", "com.tiktok", "com.game", "com.android.chrome", "org.plainphone.app"),
        core = setOf("com.dialer", "com.sms", "com.camera"),
    )
    private val store = MemoryHiddenStore()
    private val applier = PolicyApplier(device, store, sdkInt = 35)
    private val config = PolicyConfig(dnsHost = "dns.example.org", allowedPackages = setOf("com.android.chrome"))

    @Test
    fun `nothing is touched when Plainphone is not Device Owner`() {
        device.owner = false
        val results = applier.apply(config)
        assertThat(results.single().ok).isFalse()
        assertThat(device.restrictions).isEmpty()
        assertThat(device.hidden).isEmpty()
    }

    @Test
    fun `apply sets every restriction, DNS, uninstall block and auto time`() {
        val results = applier.apply(config)
        assertThat(results.filterNot { it.ok }).isEmpty()
        assertThat(device.restrictions).containsExactlyElementsIn(LockPolicy.restrictions(35))
        assertThat(device.dnsHost).isEqualTo("dns.example.org")
        assertThat(device.uninstallBlocked).containsExactly("org.plainphone.app")
        assertThat(device.autoTime).isTrue()
        assertThat(device.appRestrictions[LockPolicy.CHROME_PACKAGE]).isEqualTo(LockPolicy.chromeRestrictions)
    }

    @Test
    fun `apply hides apps outside core and allowlist but never itself`() {
        applier.apply(config)
        assertThat(device.hidden).containsExactly("com.tiktok", "com.game")
        assertThat(store.saved).containsExactly("com.tiktok", "com.game")
    }

    @Test
    fun `applying twice is stable`() {
        applier.apply(config)
        applier.apply(config)
        assertThat(device.hidden).containsExactly("com.tiktok", "com.game")
    }

    @Test
    fun `an app added to the allowlist is shown again`() {
        applier.apply(config)
        applier.apply(config.copy(allowedPackages = config.allowedPackages + "com.game"))
        assertThat(device.hidden).containsExactly("com.tiktok")
        assertThat(store.saved).containsExactly("com.tiktok")
    }

    @Test
    fun `DNS failure is reported but every other policy still holds`() {
        device.dnsFails = true
        val results = applier.apply(config)
        assertThat(results.filterNot { it.ok }.map { it.name }).containsExactly("private DNS")
        assertThat(device.restrictions).containsExactlyElementsIn(LockPolicy.restrictions(35))
        assertThat(device.hidden).isNotEmpty()
    }

    @Test
    fun `an app the system refuses to hide is reported`() {
        device.unhideable += "com.game"
        val hideStep = applier.apply(config).single { it.name.startsWith("hide apps") }
        assertThat(hideStep.ok).isFalse()
        assertThat(hideStep.detail).contains("hide com.game")
    }

    @Test
    fun `FRP is only set when account IDs are configured`() {
        applier.apply(config)
        assertThat(device.frp).isNull()
        applier.apply(config.copy(frpAccountIds = setOf("123456789")))
        assertThat(device.frp).containsExactly("123456789")
    }

    @Test
    fun `FRP unsupported on the device is reported, not fatal`() {
        device.frpUnsupported = true
        val results = applier.apply(config.copy(frpAccountIds = setOf("1")))
        assertThat(results.single { it.name.startsWith("factory reset") }.ok).isFalse()
        assertThat(device.restrictions).isNotEmpty()
    }

    @Test
    fun `lift clears restrictions, shows apps and releases DNS but keeps Device Owner`() {
        applier.apply(config)
        val results = applier.lift()
        assertThat(results.filterNot { it.ok }).isEmpty()
        assertThat(device.restrictions).isEmpty()
        assertThat(device.hidden).isEmpty()
        assertThat(device.dnsHost).isNull()
        assertThat(device.owner).isTrue()
    }

    @Test
    fun `apply after lift locks the phone again`() {
        applier.apply(config)
        applier.lift()
        applier.apply(config)
        assertThat(device.restrictions).containsExactlyElementsIn(LockPolicy.restrictions(35))
        assertThat(device.hidden).containsExactly("com.tiktok", "com.game")
    }

    @Test
    fun `release keeps Device Owner when hidden apps cannot be shown again`() {
        applier.apply(config)
        device.unhideable += "com.game"
        val results = applier.release()
        assertThat(device.owner).isTrue()
        assertThat(results.last().ok).isFalse()
        assertThat(device.hidden).contains("com.game")
    }

    @Test
    fun `a crash while listing apps is reported, not thrown`() {
        val crashing = object : DeviceControls by device {
            override fun launchablePackages(): Set<String> = throw SecurityException("boom")
        }
        val results = PolicyApplier(crashing, store, 35).apply(config)
        assertThat(results.single { it.name.startsWith("hide apps") }.ok).isFalse()
        assertThat(device.restrictions).isNotEmpty()
        assertThat(device.dnsHost).isEqualTo("dns.example.org")
    }

    @Test
    fun `release undoes everything and gives up Device Owner`() {
        applier.apply(config.copy(frpAccountIds = setOf("1")))
        applier.release()
        assertThat(device.owner).isFalse()
        assertThat(device.restrictions).isEmpty()
        assertThat(device.hidden).isEmpty()
        assertThat(device.uninstallBlocked).isEmpty()
        assertThat(device.frp).isNull()
        assertThat(device.appRestrictions[LockPolicy.CHROME_PACKAGE]).isNull()
    }
}
