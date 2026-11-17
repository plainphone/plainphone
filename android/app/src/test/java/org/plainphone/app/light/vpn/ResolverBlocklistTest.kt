// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ResolverBlocklistTest {
    @Test
    fun `the well-known resolvers are listed, IPv4 and IPv6`() {
        for (literal in listOf(
            "8.8.8.8", "8.8.4.4", "2001:4860:4860::8888", "2001:4860:4860::8844",
            "1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001",
            "9.9.9.9", "149.112.112.112", "2620:fe::fe", "2620:fe::9",
            "94.140.14.14", "94.140.15.15", "94.140.14.15", "94.140.15.16", "2a10:50c0::ad1:ff",
            "208.67.222.222", "208.67.220.220", "2620:119:35::35",
            "45.90.28.0", "45.90.30.0", "2a07:a8c0::",
            "194.242.2.2", "185.228.168.9", "76.76.2.0", "76.76.10.0", "185.222.222.222", "77.88.8.8",
        )) {
            assertThat(ResolverBlocklist.contains(IpAddress.parse(literal))).isTrue()
        }
    }

    @Test
    fun `ordinary addresses and our own are not listed`() {
        for (literal in listOf("93.184.216.34", "142.250.74.78", "10.111.222.1", "10.111.222.2", "fd00:7070::1", "fd00:7070::2", "2001:db8::1")) {
            assertThat(ResolverBlocklist.contains(IpAddress.parse(literal))).isFalse()
        }
    }

    @Test
    fun `the list has every provider and no duplicates`() {
        val all = ResolverBlocklist.addresses
        assertThat(all.toSet()).hasSize(all.size)
        assertThat(all.size).isAtLeast(100)
        assertThat(ResolverBlocklist.providerNames).containsAtLeast(
            "Google Public DNS", "Cloudflare", "Quad9", "AdGuard DNS", "OpenDNS", "NextDNS", "Mullvad", "CleanBrowsing", "Control D", "DNS.SB", "Yandex DNS",
        )
        assertThat(all.count { it.isV4 }).isGreaterThan(30)
        assertThat(all.count { !it.isV4 }).isGreaterThan(30)
    }

    @Test
    fun `IPv4 addresses come first and every address is public`() {
        val all = ResolverBlocklist.addresses
        val firstV6 = all.indexOfFirst { !it.isV4 }
        assertThat(all.drop(firstV6).none { it.isV4 }).isTrue()
        for (a in all) {
            val inet = a.toInetAddress()
            assertThat(inet.isSiteLocalAddress || inet.isLoopbackAddress || inet.isLinkLocalAddress || inet.isAnyLocalAddress || inet.isMulticastAddress).isFalse()
        }
    }

    @Test
    fun `our fake DNS servers are not in the list, so they cannot be routed twice`() {
        for (dns in VpnNetwork.dnsServers) assertThat(ResolverBlocklist.contains(dns)).isFalse()
    }

    @Test
    fun `the intercept rule covers the fake servers and the list, nothing else`() {
        assertThat(PacketPolicy.isIntercepted(IpAddress.parse("10.111.222.2"))).isTrue()
        assertThat(PacketPolicy.isIntercepted(IpAddress.parse("fd00:7070::2"))).isTrue()
        assertThat(PacketPolicy.isIntercepted(IpAddress.parse("1.1.1.1"))).isTrue()
        assertThat(PacketPolicy.isIntercepted(IpAddress.parse("10.111.222.1"))).isFalse()
        assertThat(PacketPolicy.isIntercepted(IpAddress.parse("93.184.216.34"))).isFalse()
    }
}
