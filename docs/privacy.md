# Privacy

Plainphone keeps as little data as it can, for as short a time as it can
(decision D7 in the spec). This page says exactly what each part stores. It is
the technical basis for the [privacy policy](https://plainphone.org/privacy/) on plainphone.org,
which also covers the parent app and the server. Change the two together.

## Server and parent app (`app.plainphone.org`)

The server stores accounts, households and the rules for each phone in PostgreSQL.
Sign-in links, sessions and device tokens are stored only as SHA-256 hashes.

| Data | For how long | Where it is set |
|---|---|---|
| Account (email address, language) | until the user deletes it (Settings) | `DELETE /api/me` |
| Household, phones and their rules, apps, contacts, schedules, filter settings, key | until the phone is removed or the household's last member deletes their account | `DELETE /api/phones/{pid}`, `DELETE /api/me` |
| The phone's latest status (battery, app version, lock state, DNS host) | each report replaces the last | `PUT /api/device/status` |
| Latest position (one row per phone, no history) | until location is switched off or the phone is removed | `locations` |
| Pending changes on a Self phone | while pending, then 30 days | sweeper, `CHANGE_HISTORY_DAYS` |
| Requests from a phone (an app package name, or a contact's name and number) | while open, then 30 days after they are decided | sweeper, `REQUEST_HISTORY_DAYS` |
| Push subscriptions (endpoint at the browser's push service, `p256dh` and `auth` keys, a label such as "Chrome · Android"; or an APNs/FCM token) | until the parent turns them off or removes the device, the push service answers 404/410, 20 sends in a row fail, or the account is deleted | `push_subscriptions`, `DELETE /api/notifications/subscriptions/{sid}` |
| Per parent and phone: notifications muted (one row when off) | until switched back on, the phone is removed or the account is deleted | `notification_mutes` |
| Per phone: hours of silence before an alert, and when the last offline alert went out | until the phone is removed | `phones.offline_alert_hours`, `phones.offline_alerted_at` |
| Household invitations | deleted when accepted; otherwise 1 day after they expire (7 days) | sweeper, `INVITE_GRACE_DAYS` |
| Login links | 1 day after they expire | sweeper |
| Sessions | until they expire (60 days) or the user logs out | sweeper |
| Pairings (holds a not yet collected device token in clear text) | 1 day | sweeper |
| ClientIDs the DNS filter must forget | until the DNS service confirms the delete | `dns_deletions`, sweeper |
| Database backups | 30 nightly copies on the hosted service; the sample `compose.yaml` keeps 14 daily and 8 weekly | Dokploy backup (hosted), `backup` service in `compose.yaml` |

Notifications go to the browser's push service (Google FCM, Apple, Mozilla or
Microsoft; only these hosts are accepted). The payload is encrypted for the
device (RFC 8291) and signed with our VAPID key (RFC 8292), so the push service
sees only the endpoint, the time and the size. Alerts about removed protection
and quiet phones also go out by email to every household member who has not
muted the phone.

IP addresses are only held in memory, for rate limits. The full rules for deletion,
including what happens to a household with two parents, are in
[account-deletion.md](account-deletion.md).

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
