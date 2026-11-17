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
    fun `FRP runs through the hardening steps, before private DNS`() {
        val hardening = FakeHardening()
        val results = PolicyApplier(device, store, 35, Hardening(hardening, 35)).apply(config.copy(frpAccountIds = setOf("123456789")))
        assertThat(hardening.policyAccounts).containsExactly("123456789")
        val names = results.map { it.name }
        assertThat(names.indexOf(Hardening.RESET_PROTECTION)).isLessThan(names.indexOf("private DNS"))
    }

    @Test
    fun `FRP broadcast precedes blocking account changes on apply and relock`() {
        for (sdk in listOf(29, 30, 35)) {
            val controls = FakeHardening()
            val checked = object : DeviceControls by device {
                override fun addRestriction(key: String) {
                    if (key == android.os.UserManager.DISALLOW_MODIFY_ACCOUNTS) {
                        assertThat(controls.broadcasts).isGreaterThan(0)
                        val ids = if (sdk == 29) controls.legacyFrp else controls.policyAccounts
                        assertThat(ids).containsExactly("123")
                    }
                    device.addRestriction(key)
                }
            }
            val policy = PolicyApplier(checked, store, sdk, Hardening(controls, sdk))
            val configured = config.copy(frpAccountIds = setOf("123"))
            assertThat(policy.apply(configured).single { it.name.endsWith("no_modify_accounts") }.ok).isTrue()
            policy.lift()
            assertThat(device.restrictions).doesNotContain(android.os.UserManager.DISALLOW_MODIFY_ACCOUNTS)
            controls.broadcasts = 0
            assertThat(policy.apply(configured).single { it.name.endsWith("no_modify_accounts") }.ok).isTrue()
        }
    }

    @Test
    fun `the emergency dialers stay visible and callable under strong mode limits`() {
        val systemDialer = "com.android.dialer"
        device.telephony = TelephonyApps(setOf(systemDialer, device.ownPackage), emptySet(), systemDialer)
        device.launchable += setOf(systemDialer, device.ownPackage)
        for (sdk in listOf(29, 33, 35)) {
            val results = PolicyApplier(device, store, sdk, Hardening(FakeHardening(), sdk)).apply(
                config.copy(allowedPackages = emptySet(), timeBlocked = setOf(systemDialer, device.ownPackage)),
            )
            assertThat(results.single { it.name == "time limits" }.ok).isTrue()
            assertThat(device.hidden).containsNoneOf(systemDialer, device.ownPackage)
            assertThat(device.suspended).containsNoneOf(systemDialer, device.ownPackage)
            assertThat(device.restrictions).doesNotContain(android.os.UserManager.DISALLOW_OUTGOING_CALLS)
        }
    }

    @Test
    fun `FRP unsupported on the device is reported, not fatal`() {
        val hardening = FakeHardening().apply { frpUnsupported = true }
        val results = PolicyApplier(device, store, 35, Hardening(hardening, 35)).apply(config.copy(frpAccountIds = setOf("1")))
        assertThat(results.single { it.name == Hardening.RESET_PROTECTION }.ok).isFalse()
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
        val hardening = FakeHardening()
        val applier = PolicyApplier(device, store, 35, Hardening(hardening, 35))
        applier.apply(config.copy(frpAccountIds = setOf("1")))
        applier.release()
        assertThat(hardening.policyAccounts).isNull()
        assertThat(hardening.noUserControl).isEmpty()
        assertThat(device.owner).isFalse()
        assertThat(device.restrictions).isEmpty()
        assertThat(device.hidden).isEmpty()
        assertThat(device.uninstallBlocked).isEmpty()
        assertThat(device.appRestrictions[LockPolicy.CHROME_PACKAGE]).isNull()
    }
}

class TimeLimitApplierTest {
    private val device = FakeDevice(
        launchable = mutableSetOf("com.dialer", "com.spotify", "com.game", "com.android.vending", "org.plainphone.app"),
        core = setOf("com.dialer"),
    )
    private val store = MemoryHiddenStore()
    private val applier = PolicyApplier(device, store, sdkInt = 35)
    private val config = PolicyConfig(dnsHost = "dns.example.org", allowedPackages = setOf("com.spotify"))

    @Test
    fun `used-up apps are suspended and come back when the day is new`() {
        applier.apply(config.copy(timeBlocked = setOf("com.spotify", "com.dialer")))
        assertThat(device.suspended).containsExactly("com.spotify") // core apps never
        assertThat(store.suspendedSaved).containsExactly("com.spotify")
        applier.apply(config)
        assertThat(device.suspended).isEmpty()
        assertThat(store.suspendedSaved).isEmpty()
    }

    @Test
    fun `the install window lifts the install restriction and shows Play, then closes`() {
        applier.apply(config.copy(installing = "dk.mitid.app.android"))
        assertThat(device.restrictions).doesNotContain("no_install_apps")
        assertThat(device.hidden).doesNotContain("com.android.vending")
        applier.apply(config)
        assertThat(device.restrictions).contains("no_install_apps")
        assertThat(device.hidden).contains("com.android.vending")
    }

    @Test
    fun `a maintenance unlock lifts suspensions too`() {
        applier.apply(config.copy(timeBlocked = setOf("com.spotify")))
        applier.lift()
        assertThat(device.suspended).isEmpty()
    }
}
