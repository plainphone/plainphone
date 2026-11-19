// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PolicyConfig
import org.plainphone.app.contacts.ApprovedContact
import org.robolectric.RobolectricTestRunner

/** Parsing the server's rules document and merging it into the lock config. Robolectric for org.json. */
@RunWith(RobolectricTestRunner::class)
class RulesTest {
    private val qr = PolicyConfig(dnsHost = "family.adguard-dns.com")
    private val bedtime = """[{"id":"b1","kind":"bedtime","days":[1,2,3,4,5,6,7],"start":"21:00","end":"07:00","allowedPackages":["com.spotify.music","com.example.notallowed"]}]"""

    @Test
    fun `parses the server's document`() {
        val r = ServerRules.parse(rulesJson(schedules = bedtime, requestedAt = "2027-01-04T10:00:00.000Z"))
        assertThat(r.profile).isEqualTo("child")
        assertThat(r.timezone).isEqualTo(ZoneId.of("Europe/Copenhagen"))
        assertThat(r.allowedApps).containsExactly("com.android.dialer", "com.spotify.music")
        assertThat(r.hiddenApps).containsExactly("com.example.game")
        assertThat(r.contacts).containsExactly(ApprovedContact("Mum", "+4512345678"))
        assertThat(r.schedules.single().days).hasSize(7)
        assertThat(r.dnsHost).isEqualTo("abcdefghijklmnopqrst.dns.plainphone.org")
        assertThat(r.dnsReady).isTrue()
        assertThat(r.locateRequestedAt).isEqualTo(Instant.parse("2027-01-04T10:00:00Z"))
        assertThat(r.pollSeconds).isEqualTo(60)
    }

    @Test
    fun `the filter method changes the effective policy and defaults to VPN`() {
        val now = Instant.EPOCH
        val oldRules = ServerRules.parse(rulesJson())
        val privateRules = ServerRules.parse(rulesJson().replace(
            "\"dns\":{", "\"dns\":{\"filterMethod\":\"privateDns\",",
        ))
        val vpn = EffectivePolicy.merge(qr, oldRules, now)
        val privateDns = EffectivePolicy.merge(qr, privateRules, now)
        assertThat(vpn.filterMethod.wire).isEqualTo("vpn")
        assertThat(privateDns.filterMethod.wire).isEqualTo("privateDns")
        assertThat(EffectivePolicy.fingerprint(privateDns)).isNotEqualTo(EffectivePolicy.fingerprint(vpn))
    }

    @Test
    fun `release is false unless the server says so, so an older server never releases a phone`() {
        assertThat(ServerRules.parse(rulesJson()).release).isFalse()
        assertThat(ServerRules.parse(rulesJson(release = false)).release).isFalse()
        assertThat(ServerRules.parse(rulesJson(release = true)).release).isTrue()
    }

    @Test
    fun `a server that does not say the DNS host is ready is not trusted`() {
        assertThat(ServerRules.parse(rulesJson(dnsReady = null)).dnsReady).isFalse()
        assertThat(ServerRules.parse(rulesJson(dnsReady = false)).dnsReady).isFalse()
    }

    @Test
    fun `manual Private DNS requires separate resolver confirmation`() {
        val legacy = rulesJson()
        assertThat(ServerRules.parse(legacy).dnsReady).isTrue()
        assertThat(ServerRules.parse(legacy).privateDnsReady).isFalse()
        assertThat(ServerRules.parse(legacy.replace("\"dns\":{", "\"dns\":{\"privateDnsReady\":true,")).privateDnsReady).isTrue()
    }

    @Test
    fun `malformed documents throw instead of being applied`() {
        assertThrows(Exception::class.java) { ServerRules.parse("{}") }
        assertThrows(Exception::class.java) { ServerRules.parse("<html>") }
        assertThrows(Exception::class.java) { ServerRules.parse(rulesJson(timezone = "Mars/Olympus")) }
        assertThrows(Exception::class.java) {
            ServerRules.parse(rulesJson(schedules = """[{"id":"x","kind":"school","days":[8],"start":"08:00","end":"14:00","allowedPackages":[]}]"""))
        }
    }

    @Test
    fun `without server rules the QR code decides`() {
        assertThat(EffectivePolicy.merge(qr, null, Instant.now())).isSameInstanceAs(qr)
    }

    @Test
    fun `the phone's own DNS host is used only once the DNS service knows it`() {
        val noon = Instant.parse("2027-01-04T11:00:00Z")
        val notReady = EffectivePolicy.merge(qr, ServerRules.parse(rulesJson(dnsReady = false)), noon)
        assertThat(notReady.dnsHost).isEqualTo("family.adguard-dns.com")
        val ready = EffectivePolicy.merge(qr, ServerRules.parse(rulesJson(dnsReady = true)), noon)
        assertThat(ready.dnsHost).isEqualTo("abcdefghijklmnopqrst.dns.plainphone.org")
    }

    @Test
    fun `a removed phone goes back to the QR code's DNS host, because its ClientID is deleted`() {
        val rules = ServerRules.parse(rulesJson(dnsReady = true))
        val merged = EffectivePolicy.merge(qr, rules, Instant.parse("2027-01-04T11:00:00Z"), removed = true)
        assertThat(merged.dnsHost).isEqualTo("family.adguard-dns.com")
        // Everything else from the last rules still applies.
        assertThat(merged.allowedPackages).containsExactly("com.android.dialer", "com.spotify.music")
    }

    @Test
    fun `the parent's app list replaces the QR list, and a window narrows it`() {
        val rules = ServerRules.parse(rulesJson(schedules = bedtime))
        val day = EffectivePolicy.merge(qr, rules, Instant.parse("2027-01-04T11:00:00Z")) // 12:00 local
        assertThat(day.allowedPackages).containsExactly("com.android.dialer", "com.spotify.music")
        assertThat(day.server!!.windowActive).isFalse()
        assertThat(day.server.locationRequired).isTrue()

        val night = EffectivePolicy.merge(qr, rules, Instant.parse("2027-01-04T22:00:00Z")) // 23:00 local
        assertThat(night.server!!.windowActive).isTrue()
        // A window can only allow apps the app list allows: the hidden one stays hidden.
        assertThat(night.allowedPackages).containsExactly("com.spotify.music")
        assertThat(EffectivePolicy.fingerprint(night)).isNotEqualTo(EffectivePolicy.fingerprint(day))
    }

    @Test
    fun `server URLs must be https`() {
        assertThat(PolicyConfig.normalizeServerUrl("https://pp.example.org/")).isEqualTo("https://pp.example.org")
        assertThat(PolicyConfig.normalizeServerUrl("https://pp.example.org:8443/plainphone")).isEqualTo("https://pp.example.org:8443/plainphone")
        assertThat(PolicyConfig.normalizeServerUrl("http://pp.example.org")).isNull()
        assertThat(PolicyConfig.normalizeServerUrl("https://user:pw@pp.example.org")).isNull()
        assertThat(PolicyConfig.normalizeServerUrl("https://pp.example.org/?x=1")).isNull()
        assertThat(PolicyConfig.normalizeServerUrl("not a url")).isNull()
    }
}
