// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** Phase 2: Plainphone takes the phone and SMS roles and hides the maker's phone and SMS apps. */
class TelephonyRolesTest {
    private val own = "org.plainphone.app"
    private val device = FakeDevice(
        launchable = mutableSetOf("com.google.android.dialer", "com.samsung.dialer", "com.google.android.apps.messaging", "com.camera", own),
        core = setOf("com.google.android.dialer", "com.samsung.dialer", "com.google.android.apps.messaging", "com.camera"),
    ).apply {
        telephony = TelephonyApps(
            dialers = setOf("com.google.android.dialer", "com.samsung.dialer", own),
            smsApps = setOf("com.google.android.apps.messaging", own),
            systemDialer = "com.google.android.dialer",
        )
    }
    private val store = MemoryHiddenStore()
    private val applier = PolicyApplier(device, store, sdkInt = 35)
    private val config = PolicyConfig(dnsHost = "dns.example.org")

    @Test
    fun `apply makes Plainphone the phone and SMS app and grants its permissions`() {
        val results = applier.apply(config)
        assertThat(results.filterNot { it.ok }).isEmpty()
        assertThat(device.dialerPackage).isEqualTo(own)
        assertThat(device.smsPackage).isEqualTo(own)
        assertThat(device.granted).containsExactlyElementsIn(LockPolicy.TELEPHONY_PERMISSIONS)
    }

    @Test
    fun `roles are taken before the user is locked out of changing default apps`() {
        val names = applier.apply(config).map { it.name }
        assertThat(names.indexOf("default phone app")).isLessThan(names.indexOf("restriction disallow_config_default_apps"))
        assertThat(names.indexOf("default SMS app")).isLessThan(names.indexOf("restriction disallow_config_default_apps"))
        assertThat(device.restrictions).contains(android.os.UserManager.DISALLOW_CONFIG_DEFAULT_APPS)
    }

    @Test
    fun `the maker's SMS app and extra dialers are hidden, the system dialer never`() {
        applier.apply(config)
        assertThat(device.hidden).containsExactly("com.samsung.dialer", "com.google.android.apps.messaging")
        assertThat(device.hidden).doesNotContain("com.google.android.dialer")
        assertThat(device.hidden).doesNotContain(own)
    }

    @Test
    fun `an SMS-capable app the parent allowed stays visible`() {
        device.launchable += "com.example.messenger"
        device.telephony = device.telephony.copy(smsApps = device.telephony.smsApps + "com.example.messenger")
        applier.apply(config.copy(allowedPackages = PolicyConfig.DEFAULT_ALLOWED_PACKAGES + "com.example.messenger"))
        assertThat(device.hidden).doesNotContain("com.example.messenger")
        assertThat(device.hidden).contains("com.google.android.apps.messaging")
    }

    @Test
    fun `release prefers the SMS app that came with the phone`() {
        device.telephony = device.telephony.copy(
            smsApps = setOf("com.google.android.apps.messaging", "com.samsung.android.messaging", own),
            systemSmsApps = setOf("com.samsung.android.messaging"),
        )
        applier.apply(config)
        applier.release()
        assertThat(device.smsPackage).isEqualTo("com.samsung.android.messaging")
    }

    @Test
    fun `nothing telephony is hidden when Android refuses the roles`() {
        device.refuseRoles = true
        val results = applier.apply(config)
        assertThat(results.single { it.name == "default phone app" }.ok).isFalse()
        assertThat(results.single { it.name == "default SMS app" }.ok).isFalse()
        assertThat(device.hidden).isEmpty()
        // The rest of the lock still holds.
        assertThat(device.restrictions).isNotEmpty()
    }

    @Test
    fun `no dialer is hidden when the system dialer is unknown`() {
        device.telephony = device.telephony.copy(systemDialer = null)
        applier.apply(config)
        assertThat(device.hidden).containsExactly("com.google.android.apps.messaging")
    }

    @Test
    fun `a refused permission is reported`() {
        device.refusedPermissions += android.Manifest.permission.READ_SMS
        val step = applier.apply(config).single { it.name == "phone and SMS permissions" }
        assertThat(step.ok).isFalse()
        assertThat(step.detail).contains("READ_SMS")
    }

    @Test
    fun `release hands the roles back and shows the maker's apps`() {
        applier.apply(config)
        applier.release()
        assertThat(device.dialerPackage).isEqualTo("com.google.android.dialer")
        assertThat(device.smsPackage).isEqualTo("com.google.android.apps.messaging")
        assertThat(device.hidden).isEmpty()
        assertThat(device.owner).isFalse()
    }

    @Test
    fun `lift keeps the roles`() {
        applier.apply(config)
        applier.lift()
        assertThat(device.roles).containsExactly(FakeDevice.DIALER, FakeDevice.SMS)
        assertThat(device.hidden).isEmpty()
    }
}
