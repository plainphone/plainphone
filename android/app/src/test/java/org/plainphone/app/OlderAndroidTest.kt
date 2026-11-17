// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.os.UserManager
import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** minSdk 29: what the lock does on Android 10 to 13, where some Device Owner calls do not exist yet. */
class OlderAndroidTest {
    private val own = "org.plainphone.app"
    private fun device() = FakeDevice(
        launchable = mutableSetOf("com.google.android.dialer", "com.oneplus.dialer", "com.google.android.apps.messaging", "com.game", own),
        core = setOf("com.google.android.dialer", "com.oneplus.dialer", "com.google.android.apps.messaging"),
    ).apply {
        telephony = TelephonyApps(
            dialers = setOf("com.google.android.dialer", "com.oneplus.dialer", own),
            smsApps = setOf("com.google.android.apps.messaging", own),
            systemDialer = "com.google.android.dialer",
        )
    }
    private val config = PolicyConfig(dnsHost = "dns.example.org", frpAccountIds = setOf("123"))

    @Test
    fun `restrictions that only exist on Android 14 are left out below it`() {
        for (sdk in 29..33) {
            assertThat(LockPolicy.restrictions(sdk)).doesNotContain(UserManager.DISALLOW_CONFIG_DEFAULT_APPS)
            assertThat(LockPolicy.restrictions(sdk)).doesNotContain(LockPolicy.DISALLOW_ADD_CLONE_PROFILE)
            assertThat(LockPolicy.restrictions(sdk)).contains(UserManager.DISALLOW_CONFIG_PRIVATE_DNS)
        }
        assertThat(LockPolicy.restrictions(34)).containsAtLeast(UserManager.DISALLOW_CONFIG_DEFAULT_APPS, LockPolicy.DISALLOW_ADD_CLONE_PROFILE)
    }

    @Test
    fun `POST_NOTIFICATIONS is only granted from Android 13`() {
        val perm = android.Manifest.permission.POST_NOTIFICATIONS
        assertThat(LockPolicy.telephonyPermissions(32)).doesNotContain(perm)
        assertThat(LockPolicy.telephonyPermissions(33)).contains(perm)
        val device = device()
        // Android 12 would refuse an unknown permission; the step must not ask for it.
        device.refusedPermissions += perm
        val results = PolicyApplier(device, MemoryHiddenStore(), sdkInt = 32).apply(config)
        assertThat(results.single { it.name == "phone and SMS permissions" }.ok).isTrue()
    }

    @Test
    fun `Android 10 to 13 never call the silent phone-app API and report the missing role`() {
        val device = device()
        val applier = PolicyApplier(device, MemoryHiddenStore(), sdkInt = 29)
        assertThat(applier.needsDialerDialog()).isTrue()
        val results = applier.apply(config)
        assertThat(device.dialerPackage).isNull()
        val step = results.single { it.name == "default phone app" }
        assertThat(step.ok).isFalse()
        assertThat(step.detail).contains("Android 10")
        // SMS works silently from Android 10. The maker's extra dialer is hidden even without the phone role
        // (Settings cannot be locked below Android 14); the system dialer stays as the emergency fallback.
        assertThat(device.smsPackage).isEqualTo(own)
        assertThat(device.hidden).contains("com.oneplus.dialer")
        assertThat(device.hidden).doesNotContain("com.google.android.dialer")
        assertThat(device.hidden).contains("com.google.android.apps.messaging")
        assertThat(device.hidden).contains("com.game")
    }

    @Test
    fun `once the dialog was accepted the lock is complete and the maker's dialer is hidden`() {
        val device = device().apply { roles += FakeDevice.DIALER }
        val applier = PolicyApplier(device, MemoryHiddenStore(), sdkInt = 31)
        assertThat(applier.needsDialerDialog()).isFalse()
        val results = applier.apply(config)
        assertThat(results.filterNot { it.ok }).isEmpty()
        assertThat(device.hidden).contains("com.oneplus.dialer")
        assertThat(device.hidden).doesNotContain("com.google.android.dialer")
    }

    @Test
    fun `Android 14 sets the phone app silently and never needs the dialog`() {
        val device = device()
        val applier = PolicyApplier(device, MemoryHiddenStore(), sdkInt = 34)
        assertThat(applier.needsDialerDialog()).isFalse()
        applier.apply(config)
        assertThat(device.dialerPackage).isEqualTo(own)
    }

    @Test
    fun `FRP accounts are skipped on Android 10 without failing the lock`() {
        val device = device().apply { roles += FakeDevice.DIALER; frpUnsupported = true }
        val results = PolicyApplier(device, MemoryHiddenStore(), sdkInt = 29).apply(config)
        val frp = results.single { it.name.startsWith("factory reset protection") }
        assertThat(frp.ok).isTrue()
        assertThat(frp.detail).contains("Android 11")
        assertThat(device.frp).isNull()
        assertThat(PolicyApplier(device, MemoryHiddenStore(), sdkInt = 30).apply(config).single { it.name.startsWith("factory reset protection") }.ok).isFalse()
    }

    @Test
    fun `release on Android 13 does not call the silent phone-app API`() {
        val device = device().apply { roles += FakeDevice.DIALER; roles += FakeDevice.SMS }
        val results = PolicyApplier(device, MemoryHiddenStore(), sdkInt = 33).release()
        assertThat(results.single { it.name == "give phone and SMS roles back" }.detail).contains("Settings")
        assertThat(results.map { it.name }).contains("clear FRP policy")
        assertThat(device.dialerPackage).isNull()
        assertThat(device.owner).isFalse()
    }

    @Test
    fun `after the role moved away on Android 13 only the system dialer can be picked`() {
        val device = device().apply {
            roles += FakeDevice.SMS
            telephony = telephony.copy(defaultDialer = "com.google.android.dialer")
        }
        val results = PolicyApplier(device, MemoryHiddenStore(), sdkInt = 33).apply(config)
        assertThat(results.single { it.name == "default phone app" }.ok).isFalse()
        assertThat(device.hidden).contains("com.oneplus.dialer")
        assertThat(device.hidden).doesNotContain("com.google.android.dialer")
    }

    @Test
    fun `the app that holds the phone role is never hidden`() {
        val apps = TelephonyApps(
            dialers = setOf("com.google.android.dialer", "com.oneplus.dialer", own),
            smsApps = emptySet(),
            systemDialer = "com.google.android.dialer",
            defaultDialer = "com.oneplus.dialer",
        )
        assertThat(LockPolicy.telephonyAppsToHide(apps, own, holdsDialer = false, holdsSms = false, sdkInt = 31)).isEmpty()
        // Android 14 keeps the old rule: nothing is hidden until Plainphone holds the role.
        assertThat(LockPolicy.telephonyAppsToHide(apps.copy(defaultDialer = null), own, holdsDialer = false, holdsSms = false, sdkInt = 34)).isEmpty()
    }
}
