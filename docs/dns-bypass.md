# Getting around the DNS filter (phase 2 analysis)

Plainphone forces private DNS (DNS-over-TLS) for the whole phone and blocks changing it, VPNs and user certificates (see [policies.md](policies.md)). This page lists the ways an **allowed** app could still resolve names without the filter, and whether an always-on VPN is worth adding as a later layer.

Short answer: with the phase 1 allowlist, no allowed app is known to bypass the filter. The risk grows with every app a parent allows. An always-on VPN is the right later layer, but it is not built in phase 2.

## What private DNS covers

Android's private DNS covers every lookup that goes through the system resolver (`getaddrinfo`, `InetAddress`, OkHttp and Cronet in their default setup, WebView). It does **not** cover:

1. **An app's own DNS-over-HTTPS, -TLS or -QUIC.** The app talks HTTPS to a resolver such as `cloudflare-dns.com` and never asks the system.
2. **An app's own plain DNS.** UDP or TCP port 53 straight to an IP such as `8.8.8.8`. Private DNS does not redirect those packets; it only changes what the system resolver does.
3. **Hardcoded IP addresses.** An app that connects to IPs it ships with, or gets from its own server, needs no DNS at all.
4. **Proxies and built-in "VPNs" that are not Android VPNs.** The proxy resolves names on the far side (Opera's browser VPN, Telegram's MTProto proxy, Tor-based apps).

`DISALLOW_CONFIG_VPN` already stops apps that need Android's `VpnService` (consent is refused), so real VPN apps are out. Points 1-4 remain.

## Allowed apps today

| App | Own DNS? | Status |
|---|---|---|
| Chrome | Has its own DoH ("Use secure DNS") | **Closed**: managed configuration `DnsOverHttpsMode=off`. Custom Tabs in other apps use Chrome's settings |
| Android System WebView (in-app browsers) | No: uses the system resolver | Covered |
| Google Maps, Calendar, Clock, Calculator, Gallery, Camera | Not known to use their own DNS | Covered. Maps may fall back to cached data offline, which is harmless |
| Google Messages, Samsung Messages | Hidden once Plainphone is the SMS app | Not reachable |
| Gboard | GIF and sticker search use Google endpoints through the system resolver | Covered. The content is Google's own SafeSearch-filtered results |
| Plainphone | Uses the system resolver | Covered |
| Google Play services | Talks to Google only, partly over QUIC. Not a browsing path | Out of scope |

Firefox, Brave, Edge, Opera, DuckDuckGo, Samsung Internet and Tor Browser all have their own DoH or proxy, or no managed policy for it. They are hidden by the hide plan and must not be allowed. Browsers apart from Chrome should be "never allow" in the parent's app list in phase 3.

## Apps a parent might allow

Every app a parent allows is a possible bypass. Known cases:

- **Messengers (WhatsApp, Signal, Telegram, Messenger, Snapchat):** connect to their own servers, partly by IP, and show link previews fetched by their servers. Links open in the system browser (Chrome) and are filtered there. Telegram has built-in proxy support and an in-app browser with its own engine; it is the weakest of them.
- **Games and video apps:** some ship hardcoded IPs or their own DoH as a fallback when DNS fails (TikTok is reported to do this). They are hidden by default.
- **Spotify, DR LYD, MobilePay, MitID, Aula, Rejseplanen:** use the system resolver as far as we know. Not a browsing path.

## What the DNS server does about it

The Plainphone resolver (phase 2, `dns/`) blocks the hostnames of public DoH, DoT and DoQ resolvers. That stops point 1 for apps that look up their DoH server through the system first, which is most of them (Firefox does, unless its bootstrap address is set). It does not stop apps that reach a resolver by IP (point 1 with a hardcoded IP, and points 2 and 3).

## Always-on VPN as a later layer

`DevicePolicyManager.setAlwaysOnVpnPackage(admin, ownPackage, lockdownEnabled = true)` lets Device Owner make Plainphone's own `VpnService` the always-on VPN. The user cannot turn it off. With lockdown on, no traffic leaves the phone while the VPN is down.

**What it would add**, without a full packet engine: a VPN that routes only a curated list of public resolver IPs (`1.1.1.1`, `8.8.8.8`, `9.9.9.9`, `94.140.14.14`, NextDNS, Mullvad, Quad9 and so on, IPv4 and IPv6) into its tunnel and drops those packets. That closes points 1 and 2 for every well-known resolver, also when reached by IP. Apps then fall back to the system resolver. All other traffic does not touch the VPN, so speed and battery stay the same. It is roughly 200-300 lines of code.

**What it would not add:** an unknown DoH server on an arbitrary IP behind port 443 still looks like any HTTPS site. Stopping that needs TLS inspection (SNI), which Encrypted Client Hello is making impossible. No consumer filter can do this fully.

**Open questions that need a real phone before building it:**

1. Does private DNS still apply to the phone's own lookups while a split-route VPN without its own DNS servers is up? Android treats DNS per network, and a VPN is its own network. If private DNS stops applying, the VPN must route DNS itself, which means a real DNS forwarder in the app.
2. Does lockdown mode accept a VPN that only routes a few addresses? (Expected: yes. Lockdown only matters while the VPN is down.)
3. What happens on Samsung and Xiaomi when the VPN process is killed for battery reasons? With lockdown the phone loses internet until Plainphone restarts. That is safe, but it must not happen every night.
4. Light mode (phase 4) needs a VPN-based DNS filter anyway. The always-on VPN for strong mode should share that code, not be written twice.

**Recommendation:** build it in phase 3 or 4, together with the light-mode VPN, after the bypass round on hardware shows whether any allowed app actually gets around the filter. Until then the protection is: the DoH host blocklist in the resolver, Chrome's managed configuration, `DISALLOW_CONFIG_VPN`, and keeping other browsers hidden.

## Test

The bypass checklist has the tests: N2-N4 (Chrome and in-app browsers) and C11 (a messenger's link preview and in-app browser). For each app a parent allows, open a known adult site from inside the app if it can show web pages.

## Using the phone's filter on another device

Copying or seeing the address under **Web filter** gives no indication of whether
protection is on. Only devices and apps that send their DNS requests to that
address use the filter. It blocks domains. Pages inside a site, direct IP
traffic and requests resolved by another DNS service are outside its scope.
See [router and VPN setup](self-hosting-dns.md#use-a-phones-filter-on-a-router-or-vpn).
