// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import android.app.Application
import android.app.Service
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.plainphone.app.light.LightRelease
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * What can be tested without a real VPN interface: the host rules, what the service remembers, and what it
 * reports when it stops. Opening the interface and routing packets needs a phone.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PlainphoneVpnServiceTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val events = mutableListOf<VpnEvent>()

    @Before
    fun setUp() {
        context.getSharedPreferences(PlainphoneVpnService.PREFS, Context.MODE_PRIVATE).edit().clear().commit()
        VpnEvents.listener = { events += it }
    }

    @After
    fun tearDown() {
        VpnEvents.listener = null
    }

    @Test
    fun `a host name is accepted, an address or junk is not`() {
        assertThat(PlainphoneVpnService.isValidHost("abc123.dns.plainphone.org")).isTrue()
        assertThat(PlainphoneVpnService.isValidHost("DNS.Example.ORG")).isTrue()
        assertThat(PlainphoneVpnService.isValidHost("a-b.example.org")).isTrue()
        for (bad in listOf("", "localhost", "a..b", "-a.example.org", "a-.example.org", "a b.example.org", "1.2.3.4", "dns.example.org:853", "dns.example.org/x", "a.b.c.".repeat(60))) {
            assertThat(PlainphoneVpnService.isValidHost(bad)).isFalse()
        }
    }

    @Test
    fun `the host of a start is remembered, and a restart without an intent uses it`() {
        val prefs = context.getSharedPreferences(PlainphoneVpnService.PREFS, Context.MODE_PRIVATE)
        assertThat(PlainphoneVpnService.chooseHost(null, prefs)).isNull() // nothing known yet
        assertThat(PlainphoneVpnService.chooseHost("abc123.dns.plainphone.org", prefs)).isEqualTo("abc123.dns.plainphone.org")
        assertThat(PlainphoneVpnService.chooseHost(null, prefs)).isEqualTo("abc123.dns.plainphone.org") // always-on restart: null intent
        assertThat(PlainphoneVpnService.chooseHost("not a host", prefs)).isEqualTo("abc123.dns.plainphone.org") // a bad extra changes nothing
        assertThat(PlainphoneVpnService.chooseHost("xyz789.dns.plainphone.org", prefs)).isEqualTo("xyz789.dns.plainphone.org")
        assertThat(PlainphoneVpnService.lastHost(context)).isEqualTo("xyz789.dns.plainphone.org")
    }

    @Test
    fun `start sends the host to the service and remembers it`() {
        assertThat(PlainphoneVpnService.start(context, "abc123.dns.plainphone.org")).isTrue()
        val intent = shadowOf(context).nextStartedService
        assertThat(intent.component!!.className).isEqualTo(PlainphoneVpnService::class.java.name)
        assertThat(intent.getStringExtra(PlainphoneVpnService.EXTRA_HOST)).isEqualTo("abc123.dns.plainphone.org")
        assertThat(PlainphoneVpnService.lastHost(context)).isEqualTo("abc123.dns.plainphone.org")
    }

    @Test
    fun `start refuses something that is not a host name`() {
        assertThat(PlainphoneVpnService.start(context, "8.8.8.8")).isFalse()
        assertThat(shadowOf(context).nextStartedService).isNull()
        assertThat(PlainphoneVpnService.lastHost(context)).isNull()
    }

    @Test
    fun `nothing is running, always-on or revoked before the first start`() {
        assertThat(PlainphoneVpnService.isRunning()).isFalse()
        assertThat(PlainphoneVpnService.isAlwaysOn(context)).isFalse()
        assertThat(PlainphoneVpnService.isLockdownEnabled(context)).isFalse()
        assertThat(PlainphoneVpnService.lastRevokedAt(context)).isEqualTo(0L)
    }

    @Test
    fun `a revocation is recorded and reported once, even though onDestroy follows`() {
        val controller = Robolectric.buildService(PlainphoneVpnService::class.java).create()
        val before = System.currentTimeMillis()
        controller.get().onRevoke()
        assertThat(PlainphoneVpnService.lastRevokedAt(context)).isAtLeast(before)
        assertThat(events).containsExactly(VpnEvent.Stopped)
        controller.destroy()
        assertThat(events).containsExactly(VpnEvent.Stopped) // not reported twice
    }

    @Test
    fun `a stop nobody asked for counts as a revocation`() {
        val controller = Robolectric.buildService(PlainphoneVpnService::class.java).create()
        controller.destroy() // the system took the service down
        assertThat(PlainphoneVpnService.lastRevokedAt(context)).isGreaterThan(0L)
        assertThat(events).containsExactly(VpnEvent.Stopped)
    }

    @Test
    fun `a stop that the app asked for is reported but is not a revocation`() {
        val controller = Robolectric.buildService(PlainphoneVpnService::class.java).create()
        PlainphoneVpnService.stop(context)
        controller.destroy()
        assertThat(PlainphoneVpnService.lastRevokedAt(context)).isEqualTo(0L)
        assertThat(events).containsExactly(VpnEvent.Stopped)
    }

    @Test
    fun `a start without a host stops the service without calling it a revocation`() {
        val controller = Robolectric.buildService(PlainphoneVpnService::class.java).create()
        val result = controller.get().onStartCommand(null, 0, 1) // a restart with nothing remembered
        assertThat(result).isEqualTo(Service.START_NOT_STICKY)
        controller.destroy()
        assertThat(PlainphoneVpnService.lastRevokedAt(context)).isEqualTo(0L)
    }

    @Test
    fun `Android cannot restart the filter after light mode is released`() {
        val prefs = context.getSharedPreferences(PlainphoneVpnService.PREFS, Context.MODE_PRIVATE)
        PlainphoneVpnService.chooseHost("old.dns.plainphone.org", prefs)
        LightRelease.release(context)
        val controller = Robolectric.buildService(PlainphoneVpnService::class.java).create()
        val restart = Intent().putExtra(PlainphoneVpnService.EXTRA_HOST, "new.dns.plainphone.org")
        assertThat(controller.get().onStartCommand(restart, 0, 1)).isEqualTo(Service.START_NOT_STICKY)
        assertThat(PlainphoneVpnService.lastHost(context)).isEqualTo("old.dns.plainphone.org")
        assertThat(PlainphoneVpnService.isRunning()).isFalse()
        controller.destroy()
        assertThat(PlainphoneVpnService.lastRevokedAt(context)).isEqualTo(0L)
    }

    @Test
    fun `a listener that throws does not break the service`() {
        VpnEvents.listener = { error("listener bug") }
        val controller = Robolectric.buildService(PlainphoneVpnService::class.java).create()
        controller.get().onRevoke()
        controller.destroy()
        assertThat(PlainphoneVpnService.lastRevokedAt(context)).isGreaterThan(0L)
    }
}
