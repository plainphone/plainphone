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
    fun `deadline recovery can relock while the policy clear has not returned`() {
        val cleared = java.util.concurrent.CountDownLatch(1)
        val resume = java.util.concurrent.CountDownLatch(1)
        val active = java.util.concurrent.atomic.AtomicBoolean(true)
        val restricted = java.util.concurrent.atomic.AtomicBoolean(true)
        val controls = object : DeviceControls by device {
            override fun clearRestriction(key: String) {
                restricted.set(false)
                cleared.countDown()
                check(resume.await(10, java.util.concurrent.TimeUnit.SECONDS))
                // Also exercise a stale write after the deadline write has succeeded.
                restricted.set(false)
            }

            override fun addRestriction(key: String) {
                restricted.set(true)
            }
        }
        val lease = org.plainphone.app.update.InstallLease(
            store = object : org.plainphone.app.update.InstallLease.Store {
                override fun load() = emptyMap<String, org.plainphone.app.update.InstallLease.Lease>()
                override fun save(leases: Map<String, org.plainphone.app.update.InstallLease.Lease>) = Unit
            },
            env = object : org.plainphone.app.update.InstallLease.Env {
                override fun nowMs() = 0L
                override fun bootCount() = 0
                override fun processId() = "test"
                override fun versionCode() = 0L
                override fun scheduleExpiry(holder: String, atMs: Long) = Unit
            },
            relockNow = { controls.addRestriction(android.os.UserManager.DISALLOW_INSTALL_APPS) },
            restrictionLifted = { !restricted.get() },
        ) { _, _ -> error("Unexpected full policy apply") }
        val policy = PolicyApplier(controls, store, sdkInt = 35, installsAllowed = { active.get() })
        val executor = java.util.concurrent.Executors.newFixedThreadPool(2)
        try {
            val opening = executor.submit<StepResult> { policy.applyInstallRestriction(config) }
            check(cleared.await(5, java.util.concurrent.TimeUnit.SECONDS))
            active.set(false)
            executor.submit { lease.recover() }.get(2, java.util.concurrent.TimeUnit.SECONDS)
            assertThat(restricted.get()).isTrue()
            assertThat(opening.isDone).isFalse()
            resume.countDown()
            opening.get(5, java.util.concurrent.TimeUnit.SECONDS)
            assertThat(restricted.get()).isTrue()
        } finally {
            resume.countDown()
            executor.shutdownNow()
        }
    }

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
    fun `release retries Chrome cleanup before giving up Device Owner`() {
        applier.apply(config)
        var chromeFails = true
        val flaky = object : DeviceControls by device {
            override fun setAppRestrictions(pkg: String, values: Map<String, Any>?) {
                if (chromeFails) throw SecurityException("temporary failure")
                device.setAppRestrictions(pkg, values)
            }
        }
        val releasing = PolicyApplier(flaky, store, sdkInt = 35)

        assertThat(releasing.release().filterNot { it.ok }.map { it.name })
            .contains("clear Chrome managed config")
        assertThat(device.owner).isTrue()

        chromeFails = false
        assertThat(releasing.release().filterNot { it.ok }).isEmpty()
        assertThat(device.owner).isFalse()
    }

    @Test
    fun `release succeeds without FRP support and after Device Owner is already gone`() {
        device.frpUnsupported = true
        assertThat(applier.release().filterNot { it.ok }).isEmpty()
        assertThat(device.owner).isFalse()
        assertThat(applier.release().filterNot { it.ok }).isEmpty()
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
