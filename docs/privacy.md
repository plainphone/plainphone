# Privacy

Plainphone keeps as little data as it can, for as short a time as it can
(decision D7 in the spec). This page says exactly what each part stores. It is
the technical basis for the [privacy policy](https://plainphone.org/privacy/) on plainphone.org,
which also covers the parent app and the server. Change the two together.

## DNS filter (`dns.plainphone.org`)

Every web address a phone looks up passes through the filter. That is
sensitive, so the filter is set up to forget it.

| Data | Stored? | For how long | Where it is set |
|---|---|---|---|
| Which domains a phone looked up (query log) | **No.** The query log is switched off, and every phone is also excluded from it (`ignore_querylog`) in case it is switched on by mistake | not kept | `querylog.enabled: false`, `file_enabled: false`, `size_memory: 0` |
| The phone's IP address | **No.** AdGuard Home anonymizes client IPs (cuts off the host part) before they reach its statistics or logs | not kept | `dns.anonymize_client_ip: true` |
| Counters (number of queries, number blocked, top domains, top ClientIDs) | Yes, as totals only, without IP addresses | 24 hours, then deleted | `statistics.interval: 24h` |
| The phone's ClientID and profile (child or self, adult content on/off, its own allowed and blocked domains) | Yes. This is the filter's configuration | until the phone is removed | `AdGuardHome.yaml`, backups below |
| Backups of that configuration | Yes | the last 14 daily copies, so a removed phone is gone from backups after 14 days | ppdns backup, in the server's data volume and in object storage in the EU (Hetzner, Helsinki) |
| Server logs | Only start-up, errors and list updates. ppdns logs API calls without the ClientID. AdGuard Home's verbose log, which would contain queries, is off | the platform's log retention | `log.verbose: false` |

The ClientID is a random 20-character string. It is not derived from a phone
number, a name or a device id, and the filter has no way to link it to a
person. Only the Plainphone server knows which ClientID belongs to which
account.

What the filter sends onwards:

- **Upstream DNS.** Allowed lookups are resolved through [Quad9](https://quad9.net/privacy/policy/) (Switzerland; no logging of IP addresses) and [Mullvad](https://mullvad.net/en/help/dns-over-https-and-dns-over-tls) over encrypted DNS-over-HTTPS, with Cloudflare as a fallback. They see the domain and the filter server's address, never the phone's. EDNS Client Subnet is off, so no part of the phone's IP address is passed on.
- **No lookups by AdGuard.** AdGuard Home's safe-browsing and parental-control services (which ask AdGuard's servers about hashed domains) are off. Reverse DNS, WHOIS and ARP lookups of clients are off.
- **Blocklists** are downloaded from GitHub and oisd.nl. That request contains nothing about phones.

Hosting: one server at Hetzner in Germany (Nuremberg). The admin interface and
the management API are not reachable from the internet, only over a private
network (Tailscale).

If you run the filter yourself ([self-hosting-dns.md](self-hosting-dns.md)),
these settings come with the first configuration ppdns writes.
