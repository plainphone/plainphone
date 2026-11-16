// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** Phase 4: what the parent's rules from the server do to the lock. */
class ServerOverlayTest {
    private val own = "org.plainphone.app"
    private val device = FakeDevice(
        launchable = mutableSetOf(
            "com.google.android.dialer", "com.samsung.messaging", "com.camera", "com.clock", "com.launcher",
            "com.spotify.music", "com.example.game", "com.google.android.apps.maps", own,
        ),
        core = setOf("com.google.android.dialer", "com.samsung.messaging", "com.camera", "com.clock", "com.launcher"),
    ).apply {
        roles += setOf("android.app.role.DIALER", "android.app.role.SMS")
        telephony = TelephonyApps(
            dialers = setOf("com.google.android.dialer", own),
            smsApps = setOf("com.samsung.messaging", own),
            systemDialer = "com.google.android.dialer",
        )
    }
    private val store = MemoryHiddenStore()
    private val applier = PolicyApplier(device, store, sdkInt = 35)
    private val server = PolicyConfig(
        dnsHost = "abc.dns.plainphone.org",
        allowedPackages = setOf("com.spotify.music", "com.google.android.apps.maps", "com.samsung.messaging"),
        server = ServerOverlay(),
    )

    @Test
    fun `the parent's list decides, but the maker's SMS app stays hidden even if the list shows it`() {
        val results = applier.apply(server)
        assertThat(results.filterNot { it.ok }).isEmpty()
        assertThat(device.hidden).containsExactly("com.example.game", "com.samsung.messaging")
        assertThat(device.dnsHost).isEqualTo("abc.dns.plainphone.org")
    }

    @Test
    fun `school time hides every non-core app outside the window's list, and gives it back afterwards`() {
        applier.apply(server.copy(allowedPackages = setOf("com.google.android.apps.maps"), server = ServerOverlay(windowActive = true)))
        assertThat(device.hidden).containsExactly("com.spotify.music", "com.example.game", "com.samsung.messaging")
        // Core apps are never hidden, also not in a window.
        assertThat(device.hidden).containsNoneOf("com.google.android.dialer", "com.camera", "com.clock", "com.launcher", own)

        applier.apply(server)
        assertThat(device.hidden).containsExactly("com.example.game", "com.samsung.messaging")
    }

    @Test
    fun `location on, permission granted by Device Owner, location switched on and locked on`() {
        val results = applier.apply(server.copy(server = ServerOverlay(locationRequired = true)))
        assertThat(results.filterNot { it.ok }).isEmpty()
        assertThat(device.granted).containsAtLeastElementsIn(LockPolicy.LOCATION_PERMISSIONS)
        assertThat(device.locationOn).isTrue()
        assertThat(device.restrictions).contains(LockPolicy.LOCATION_RESTRICTION)

        applier.apply(server)
        assertThat(device.restrictions).doesNotContain(LockPolicy.LOCATION_RESTRICTION)
    }

    @Test
    fun `a refused location permission is reported`() {
        device.refusedPermissions += android.Manifest.permission.ACCESS_BACKGROUND_LOCATION
        val failed = applier.apply(server.copy(server = ServerOverlay(locationRequired = true))).filterNot { it.ok }
        assertThat(failed.single().name).isEqualTo("location permission")
    }

    @Test
    fun `lift frees the location setting too`() {
        applier.apply(server.copy(server = ServerOverlay(locationRequired = true)))
        applier.lift()
        assertThat(device.restrictions).isEmpty()
    }
}
