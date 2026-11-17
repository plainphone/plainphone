// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

/**
 * Well-known public DNS resolvers. The VPN routes exactly these addresses into its tunnel, so an app
 * that talks to one of them directly (plain DNS on port 53, DNS-over-TLS on 853, DNS-over-HTTPS on 443,
 * anything else) reaches the filter instead of the internet: DNS on port 53 is answered by the
 * Plainphone resolver, every other packet is dropped and the app falls back to the system resolver.
 *
 * Only addresses the provider itself publishes are listed, with the page they come from. An address
 * that a provider shares with ordinary websites is left out (for example the CDN addresses behind
 * `cloudflare-dns.com`): routing them would break unrelated sites. Resolvers that an app reaches by
 * host name are handled by the Plainphone DNS server, which blocks the names of public DoH/DoT/DoQ
 * resolvers (docs/dns-bypass.md).
 *
 * The Google, Cloudflare, Quad9, AdGuard, Mullvad, DNS.SB, Control D and Yandex entries and the OpenDNS IPv4 ones were
 * compared with the providers' own pages on 2026-11-17. The others are from the providers' setup
 * pages as known; a wrong entry only sends some stranger's address into the tunnel, where it is dropped.
 */
object ResolverBlocklist {
    /** Provider name to its published addresses. The name is for readers of the code, it is never used at run time. */
    private val providers: Map<String, List<String>> = linkedMapOf(
        // https://developers.google.com/speed/public-dns/docs/using (IPv6 and DNS64 included)
        "Google Public DNS" to listOf(
            "8.8.8.8", "8.8.4.4",
            "2001:4860:4860::8888", "2001:4860:4860::8844",
            "2001:4860:4860::64", "2001:4860:4860::6464",
        ),
        // https://developers.cloudflare.com/1.1.1.1/ip-addresses/ (standard, malware blocking, malware and adult blocking)
        "Cloudflare" to listOf(
            "1.1.1.1", "1.0.0.1", "2606:4700:4700::1111", "2606:4700:4700::1001",
            "1.1.1.2", "1.0.0.2", "2606:4700:4700::1112", "2606:4700:4700::1002",
            "1.1.1.3", "1.0.0.3", "2606:4700:4700::1113", "2606:4700:4700::1003",
        ),
        // https://quad9.net/service/service-addresses-and-features/ (recommended, secured with ECS, unsecured)
        "Quad9" to listOf(
            "9.9.9.9", "149.112.112.112", "2620:fe::fe", "2620:fe::9",
            "9.9.9.11", "149.112.112.11", "2620:fe::11", "2620:fe::fe:11",
            "9.9.9.10", "149.112.112.10", "2620:fe::10", "2620:fe::fe:10",
        ),
        // https://adguard-dns.io/en/public-dns.html (default, non-filtering, family protection)
        "AdGuard DNS" to listOf(
            "94.140.14.14", "94.140.15.15", "2a10:50c0::ad1:ff", "2a10:50c0::ad2:ff",
            "94.140.14.140", "94.140.14.141", "2a10:50c0::1:ff", "2a10:50c0::2:ff",
            "94.140.14.15", "94.140.15.16", "2a10:50c0::bad1:ff", "2a10:50c0::bad2:ff",
        ),
        // https://www.opendns.com/setupguide/ (OpenDNS Home and FamilyShield; the IPv6 pair is from OpenDNS's IPv6 support article)
        "OpenDNS" to listOf(
            "208.67.222.222", "208.67.220.220", "2620:119:35::35", "2620:119:53::53",
            "208.67.222.123", "208.67.220.123",
        ),
        // NextDNS setup page (my.nextdns.io): the anycast addresses; the per-configuration "linked IP" variants are not listed
        "NextDNS" to listOf(
            "45.90.28.0", "45.90.30.0", "2a07:a8c0::", "2a07:a8c1::",
        ),
        // https://mullvad.net/en/help/dns-over-https-and-dns-over-tls (default and the content-blocking variants)
        "Mullvad" to listOf(
            "194.242.2.2", "194.242.2.3", "194.242.2.4", "194.242.2.5", "194.242.2.6", "194.242.2.9",
            "2a07:e340::2", "2a07:e340::3", "2a07:e340::4", "2a07:e340::5", "2a07:e340::6", "2a07:e340::9",
        ),
        // https://cleanbrowsing.org/filters/ (family, adult and security filters; the page loads the list with script)
        "CleanBrowsing" to listOf(
            "185.228.168.168", "185.228.169.168", "2a0d:2a00:1::", "2a0d:2a00:2::",
            "185.228.168.10", "185.228.169.11", "2a0d:2a00:1::1", "2a0d:2a00:2::1",
            "185.228.168.9", "185.228.169.9", "2a0d:2a00:1::2", "2a0d:2a00:2::2",
        ),
        // https://docs.controld.com/docs/free-dns (profiles p0 to p3 and family, primary and secondary)
        "Control D" to listOf(
            "76.76.2.0", "76.76.2.1", "76.76.2.2", "76.76.2.3", "76.76.2.4",
            "76.76.10.0", "76.76.10.1", "76.76.10.2", "76.76.10.3", "76.76.10.4",
            "2606:1a40::", "2606:1a40::1", "2606:1a40::2", "2606:1a40::3", "2606:1a40::4",
            "2606:1a40:1::", "2606:1a40:1::1", "2606:1a40:1::2", "2606:1a40:1::3", "2606:1a40:1::4",
        ),
        // https://dns.sb/guide/
        "DNS.SB" to listOf("185.222.222.222", "45.11.45.11", "2a09::", "2a11::"),
        // https://dns.yandex.com/ (basic, safe, family; IPv6 likewise)
        "Yandex DNS" to listOf(
            "77.88.8.8", "77.88.8.1", "77.88.8.88", "77.88.8.2", "77.88.8.7", "77.88.8.3",
            "2a02:6b8::feed:ff", "2a02:6b8:0:1::feed:ff",
            "2a02:6b8::feed:bad", "2a02:6b8:0:1::feed:bad",
            "2a02:6b8::feed:a11", "2a02:6b8:0:1::feed:a11",
        ),
        // Verisign Public DNS, published at publicdnsforum.verisign.com
        "Verisign" to listOf("64.6.64.6", "64.6.65.6", "2620:74:1b::1:1", "2620:74:1c::2:2"),
        // TWNIC Quad101, published at 101.101.101.101
        "Quad101" to listOf("101.101.101.101", "2001:de4::101", "2001:de4::102"),
        // DNS0.EU default resolvers, published at dns0.eu
        "DNS0.EU" to listOf("193.110.81.0", "185.253.5.0", "2a0f:fc80::", "2a0f:fc81::"),
        // Neustar UltraDNS public recursive DNS (setup page of the provider)
        "Neustar UltraDNS" to listOf("156.154.70.1", "156.154.71.1"),
        // Hurricane Electric open resolver, ordns.he.net
        "Hurricane Electric" to listOf("74.82.42.42", "2001:470:20::2"),
    )

    /** Every listed address, IPv4 first, in a stable order. Each one becomes a route of the VPN. */
    val addresses: List<IpAddress> = providers.values.flatten().map { IpAddress.parse(it) }
        .distinct()
        .sortedBy { if (it.isV4) 0 else 1 }

    private val set: Set<IpAddress> = addresses.toSet()

    fun contains(address: IpAddress): Boolean = address in set

    /** Provider names, for the settings screen and for tests. */
    val providerNames: Set<String> get() = providers.keys
}
