// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.os.UserManager
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.plainphone.app.FakeDevice
import org.plainphone.app.MemoryHiddenStore
import org.plainphone.app.PolicyApplier
import org.plainphone.app.PolicyConfig

/**
 * Issue #168: in strong mode approved apps never got updates, because DISALLOW_INSTALL_APPS
 * also blocks updates and a hidden Play Store cannot run its own updates. The app update
 * window lifts both for a bounded time through the same lease as the catalog window.
 */
class AppUpdatePolicyTest {
    private val maps = "com.google.android.apps.maps"
    private val device = FakeDevice(
        launchable = mutableSetOf("com.dialer", PolicyConfig.PLAY_STORE, maps, "com.game"),
        core = setOf("com.dialer"),
    )
    private val store = MemoryHiddenStore()
    private val base = PolicyConfig(dnsHost = "dns.example.org", allowedPackages = setOf(maps))

    private var now = 1_000L
    private var process = "first"
    private var boot = 1
    private var restricted = true
    private var saved = emptyMap<String, InstallLease.Lease>()
    private val lease = InstallLease(
        store = object : InstallLease.Store {
            override fun load() = saved
            override fun save(leases: Map<String, InstallLease.Lease>) { saved = leases }
        },
        env = object : InstallLease.Env {
            override fun nowMs() = now
            override fun bootCount() = boot
            override fun processId() = process
            override fun versionCode() = 0L
            override fun scheduleExpiry(holder: String, atMs: Long) = Unit
        },
        relockNow = { device.addRestriction(UserManager.DISALLOW_INSTALL_APPS) },
        restrictionLifted = { UserManager.DISALLOW_INSTALL_APPS !in device.restrictions },
    ) { _, _ -> error("Unexpected full policy apply") }
    private val applier = PolicyApplier(
        device, store, sdkInt = 35,
        clearInstallsIfAllowed = { config, clear -> lease.clearIfAllowed(config.installing != null, clear) },
        installsAllowed = { config -> lease.allowsInstall(config.installing != null) },
    )

    /** What Lock.effectiveConfig does: the window is open while its lease is. */
    private fun config() = base.copy(updatingApps = lease.isOpen(InstallLease.APP_UPDATES))

    @Test
    fun `outside a window an approved app cannot be updated`() {
        applier.apply(config())
        assertThat(device.restrictions).contains(UserManager.DISALLOW_INSTALL_APPS)
        assertThat(device.hidden).contains(PolicyConfig.PLAY_STORE)
        assertThat(device.hidden).doesNotContain(maps)
    }

    @Test
    fun `an app update window lets Play update approved apps and the lock comes back`() {
        applier.apply(config())
        lease.begin(InstallLease.APP_UPDATES, AppUpdateWindow.WINDOW_MS)
        applier.apply(config())
        assertThat(device.restrictions).doesNotContain(UserManager.DISALLOW_INSTALL_APPS)
        assertThat(device.hidden).doesNotContain(PolicyConfig.PLAY_STORE)
        // Unapproved apps stay hidden during the window.
        assertThat(device.hidden).contains("com.game")

        now += AppUpdateWindow.WINDOW_MS
        lease.recover("deadline")
        applier.apply(config())
        assertThat(device.restrictions).contains(UserManager.DISALLOW_INSTALL_APPS)
        assertThat(device.hidden).contains(PolicyConfig.PLAY_STORE)
    }

    @Test
    fun `the app update window is longer than an install window but still bounded`() {
        lease.begin(InstallLease.APP_UPDATES, 10 * 60 * 60_000L)
        now += AppUpdateWindow.WINDOW_MS - 1
        assertThat(lease.isOpen(InstallLease.APP_UPDATES)).isTrue()
        now += 1
        assertThat(lease.isOpen(InstallLease.APP_UPDATES)).isFalse()
        assertThat(AppUpdateWindow.WINDOW_MS).isGreaterThan(InstallLease.MAX_MS)
    }

    @Test
    fun `the restriction comes back after the app process dies`() {
        lease.begin(InstallLease.APP_UPDATES, AppUpdateWindow.WINDOW_MS)
        applier.apply(config())
        assertThat(device.restrictions).doesNotContain(UserManager.DISALLOW_INSTALL_APPS)
        process = "second"
        assertThat(lease.isOpen(InstallLease.APP_UPDATES)).isFalse()
        lease.recover("app started")
        assertThat(device.restrictions).contains(UserManager.DISALLOW_INSTALL_APPS)
        assertThat(lease.hasMarkers()).isFalse()
        applier.apply(config())
        assertThat(device.hidden).contains(PolicyConfig.PLAY_STORE)
    }

    @Test
    fun `the restriction comes back after a reboot`() {
        lease.begin(InstallLease.APP_UPDATES, AppUpdateWindow.WINDOW_MS)
        applier.apply(config())
        boot = 2
        now = 50L // elapsed time starts again after a reboot
        lease.recover("boot")
        assertThat(device.restrictions).contains(UserManager.DISALLOW_INSTALL_APPS)
        applier.apply(config())
        assertThat(device.hidden).contains(PolicyConfig.PLAY_STORE)
    }

    @Test
    fun `closing the window early relocks while a catalog window keeps its own lease`() {
        lease.begin(InstallLease.APP_UPDATES, AppUpdateWindow.WINDOW_MS)
        lease.begin(InstallLease.SELF_UPDATE, 10_000)
        applier.apply(config())
        lease.release(InstallLease.APP_UPDATES)
        // Another open lease still needs installs: no relock yet.
        assertThat(device.restrictions).doesNotContain(UserManager.DISALLOW_INSTALL_APPS)
        lease.release(InstallLease.SELF_UPDATE)
        assertThat(device.restrictions).contains(UserManager.DISALLOW_INSTALL_APPS)
    }

    @Test
    fun `a second window cannot be opened while one is open`() {
        lease.begin(InstallLease.APP_UPDATES, AppUpdateWindow.WINDOW_MS)
        val first = saved.getValue(InstallLease.APP_UPDATES).untilMs
        now += 60_000
        runCatching { lease.begin(InstallLease.APP_UPDATES, AppUpdateWindow.WINDOW_MS) }
        assertThat(saved.getValue(InstallLease.APP_UPDATES).untilMs).isEqualTo(first)
    }

    @Test
    fun `a new app caught during the window stays hidden even in open mode`() {
        val open = base.copy(openBlocked = emptySet(), heldBack = setOf("com.new"))
        device.launchable += "com.new"
        applier.apply(open)
        assertThat(device.hidden).contains("com.new")
        assertThat(device.hidden).doesNotContain("com.game")
        applier.apply(open.copy(heldBack = emptySet()))
        assertThat(device.hidden).doesNotContain("com.new")
    }
}
