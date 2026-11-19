# Light mode: the DNS-only VPN

In light mode Plainphone is not Device Owner, so it cannot force Android's private DNS. The default filter uses a local VPN that carries **only DNS**. This page describes that VPN and the [Private DNS option](#private-dns-and-other-vpns). The rest of light mode is in `light-mode.md`.

Code: [`android/app/src/main/java/org/plainphone/app/light/vpn/`](../android/app/src/main/java/org/plainphone/app/light/vpn).

## What it does

Apps on the phone are told to use two DNS servers that do not exist on any network: `10.111.222.2` and `fd00:7070::2`. Their addresses are routed into the VPN, so every lookup an app makes through the system resolver arrives in the tunnel as a UDP packet to port 53. Plainphone reads the query, asks the phone's own resolver `<id>.dns.plainphone.org` over **DNS-over-TLS** (port 853, certificate checked against that name) and writes the answer back. If the resolver cannot be reached, the app gets a `SERVFAIL` at once instead of waiting.

The VPN also routes the addresses of about 60 well-known public resolvers into the tunnel (`ResolverBlocklist`: Google, Cloudflare, Quad9, AdGuard, OpenDNS, NextDNS, Mullvad, CleanBrowsing, Control D, DNS.SB, Yandex and more, IPv4 and IPv6). That closes the two bypasses that private DNS cannot:

| An app tries | What happens |
|---|---|
| Plain DNS to `8.8.8.8:53`, `1.1.1.1:53`... | Answered by the Plainphone resolver, from the address the app asked, so the app notices nothing |
| DNS-over-TLS (853), DNS-over-HTTPS (443), DNS-over-QUIC or anything else to those addresses | Dropped. The app falls back to the system resolver, which is the filtered one |
| TCP to our own fake DNS servers (including Android's private DNS probe on port 853) | Dropped. Android then uses plain DNS to the fake servers |

Nothing else goes through the VPN: there is no default route, so browsing, video and downloads take the normal network. Speed and battery are the same as without the VPN. Plainphone itself is excluded from the VPN (`addDisallowedApplication`), so its own DoT connection and its sync with the dashboard never loop back into the tunnel.

Details: session name "Plainphone filter", address `10.111.222.1/32` and `fd00:7070::1/128`, MTU 1500, blocking reads, not metered. At most 8 queries are asked upstream at the same time; up to 4 TLS connections are kept open for the next query and closed after 30 seconds idle; one query waits at most 5 seconds per attempt and is tried once more on a fresh connection.

## What it does not do

- It does not see, filter or log anything but DNS. It is not a firewall and does not inspect TLS.
- An app that reaches a DoH server on an address that is not in the list, or that connects to hard-coded IP addresses, is not stopped. The Plainphone DNS server blocks the host names of public DoH, DoT and DoQ resolvers, which covers apps that look the server up first (see [dns-bypass.md](dns-bypass.md)). No consumer filter can do more once Encrypted Client Hello is common.
- Another VPN app, a built-in browser VPN or a proxy bypasses it. Android allows one VPN at a time, so starting another VPN switches ours off and Plainphone sees `onRevoke`.
- The user can turn the VPN off in Android's settings unless Plainphone is Device Owner. Plainphone sees that (see below) and reports it to the parent.
- It never logs a DNS name or an address. Counters only.

## Starting it and finding out that it stopped

```kotlin
val consent = PlainphoneVpnService.prepareIntent(context)   // null once the user has agreed
if (consent != null) activity.startActivityForResult(consent, REQUEST_VPN)
PlainphoneVpnService.start(context, "abc123.dns.plainphone.org")
PlainphoneVpnService.stop(context)                          // on purpose, not counted as a revocation
```

- The service is a normal `VpnService`, not a foreground service. The system shows the key icon while it runs.
- `onStartCommand` returns `START_STICKY`. When the system or the always-on VPN restarts it with a null intent, it reuses the host of the last start (preferences file `plainphone_vpn`, key `host`).
- `VpnEvents.listener` gets `VpnEvent.Started` and `VpnEvent.Stopped`. `onRevoke` (the user or another VPN took it away) and an unrequested `onDestroy` also store `vpn_revoked_at` (epoch ms) in the same preferences; `PlainphoneVpnService.lastRevokedAt(context)` reads it. A stop through `stop()` is reported as `Stopped` but is not a revocation.
- `PlainphoneVpnService.isRunning()` is true while the interface is up. `isAlwaysOn(context)` and `isLockdownEnabled(context)` are answered by the running service, because Android answers that question only to the service itself; both are false while it is not running.
- `start()` returns false when Android refuses to start the service from the background. Start it from an activity, a worker that Android treats as foreground, or the always-on mechanism.

## Private DNS: the case that bypasses it

Android's Private DNS (Settings, Network, Private DNS) has three modes:

- **Off**, or **Automatic**: the VPN works as described. In Automatic mode Android tries DNS-over-TLS to our fake servers, the tunnel drops the connection, and Android uses plain DNS to them.
- **A host name** (strict mode): Android sends the lookups of that network as DNS-over-TLS to the host the user typed, **instead of** to the DNS servers of the VPN. If the user types a resolver that the filter does not know, every lookup bypasses Plainphone. If the host is one of the well-known resolvers, its address is routed into the tunnel and dropped; strict mode does not fall back, so lookups then fail altogether.

Plainphone cannot change this setting in light mode (that needs Device Owner or `WRITE_SECURE_SETTINGS`), so it must **detect and report** it. `LinkProperties.getPrivateDnsServerName()` (API 28) returns the host in strict mode and null in Off and Automatic; `LinkProperties.isPrivateDnsActive()` says whether private DNS is in use at all. Read both for the active network (`ConnectivityManager.getLinkProperties(getActiveNetwork())`) and for the VPN network, whenever the network changes and on every sync. A non-null name that is not the phone's own `<id>.dns.plainphone.org` means `privateDnsOk = false`, and the parent should be told which setting to change back. Do not log or send the host name itself: it can be the child's own choice of server.

## Always-on VPN and "Block connections without VPN"

Always-on VPN (Settings, Network, VPN, the gear next to "Plainphone filter") makes Android start the VPN at boot and restart it when it dies, with a null intent. For Plainphone VPN, turn it on: without it the filter is off after a kill or a reboot until the app is next opened. The user can turn it off again; `isAlwaysOn()` lets Plainphone report that while the service runs.

**Block connections without VPN** (lockdown) is a different matter. Android applies it to every packet of the phone's apps that does not leave through the VPN, and this VPN carries only DNS, so the expected result is that all other traffic is blocked and the phone has no internet. Plainphone itself is exempt. Do not tell parents to turn it on until it has been tested on a real phone (open question 2 in [dns-bypass.md](dns-bypass.md)). The Device Owner variant, `DevicePolicyManager.setAlwaysOnVpnPackage(admin, packageName, lockdownEnabled)`, has the same question.

## Google Play

Google Play only allows `VpnService` for apps whose core function needs it, and lists parental control among the permitted uses. The app must still **declare** it: the VpnService declaration in Play Console, a store listing that says what the VPN does, and no use of the VPN for ads or anything else. Two things to say in the declaration: the VPN carries DNS only, and traffic never goes to a Plainphone VPN server but to the family's own DoT resolver. APK and F-Droid builds are not affected. Nothing has been submitted to Google Play.

## Testing

`./gradlew :app:testDebugUnitTest --tests 'org.plainphone.app.light.vpn.*'` covers the packet code, the blocklist, the DNS-over-TLS framing, connection pool and retry (against a local server), the forwarding loop with a fake upstream, and what the service stores and reports. Opening the interface and routing real packets needs a phone; the checks to run there:

1. VPN on: `nslookup example.com` in a terminal app gets an answer, and a blocked adult site gets the filter's answer.
2. `nslookup example.com 8.8.8.8` gets an answer from the Plainphone resolver (a blocked site is blocked even through 8.8.8.8).
3. An app with its own DoH to `1.1.1.1` falls back and the site is still filtered.
4. Browsing, video and downloads do not slow down and do not pass through the VPN.
5. Settings, Private DNS, a host name: Plainphone reports it. Turn the VPN off in settings: `vpn_revoked_at` is set and the parent is told.
6. Kill the app from the recents list and reboot with always-on: the VPN comes back by itself.

## Private DNS and other VPNs

Light-mode phones can choose **Private DNS** in **Web filter**. Plainphone stops
its local VPN. Copy the phone-specific hostname from Plainphone on Android and
set it as the **Private DNS provider hostname** in **Network & internet**.
Disable Plainphone’s Android always-on VPN and connection blocking if they
were enabled. In Tailscale, turn off **Use Tailscale DNS settings**. MagicDNS
names will be unavailable. A work VPN may enforce its own DNS or block access
to the resolver. Check status with the intended VPN connected.

Plainphone checks that Android is in strict hostname mode, that the active
network shows the expected validated provider, and that Android can resolve a
fresh test name to a dedicated Plainphone answer. The resolver serves this
answer over its existing DNS-over-TLS endpoint on TCP 853. A working result
covers the Android DNS path the app tested. VPN-internal DNS, an app’s own
resolver, and direct IP connections can follow a different path.
The dashboard distinguishes an off or automatic setting, a different hostname,
an address still being provisioned, and a check that could not be confirmed.
A phone without working network access reports its condition when it reconnects.

When switching back to **Plainphone VPN**, disconnect the other VPN and open
Plainphone to grant Android VPN permission if prompted. Restore Android Private
DNS to **Automatic** after releasing or removing a phone that used its
Plainphone hostname, since removing its ClientID can leave Android without DNS.

See the [VPN coexistence research](research/vpn-coexistence.md) for test conditions
and version-specific limits.
