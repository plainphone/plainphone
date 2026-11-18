# Privacy

Plainphone keeps as little data as it can, for as short a time as it can
(decision D7 in the spec). This page says exactly what each part stores. It is
the technical basis for the [privacy policy](https://plainphone.org/privacy/) on plainphone.org,
which also covers the parent app and the server. Change the two together.

End-to-end encryption is under development. The hosted service is a test
version, and the application server can read the contents described below.
The [encryption specification](encryption.md) describes the planned storage
model and the metadata it will still expose.

## Server and parent app (`app.plainphone.org`)

The server stores accounts, households and the rules for each phone in PostgreSQL.
Sign-in links, sessions and device tokens are stored only as SHA-256 hashes.

| Data | For how long | Where it is set |
|---|---|---|
| Account (email address, language) | until the user deletes it (Settings) | `DELETE /api/me` |
| Household, phones and their rules, apps, contacts, schedules, filter settings, key | until the phone is removed or the household's last member deletes their account | `DELETE /api/phones/{pid}`, `DELETE /api/me` |
| The phone's latest status (battery, app version, lock state, DNS host) | each report replaces the last | `PUT /api/device/status` |
| Reset protection (numeric Google account ID per parent and household, and when it was linked) | until the parent disconnects it in Household settings, deletes their Plainphone account, or the household is deleted. A former member's ID is excluded from rules as soon as they leave. Google email addresses and OAuth tokens are not stored for this feature | `frp_accounts`, `DELETE /api/households/{hid}/reset-protection/mine` |
| Latest system check (verdict, hardware key security level, boot state, lock state, patch level and check time) | A negative finding and its timestamp survive an inconclusive check, whose timestamp is recorded separately, including when the server’s certificate verifier is temporarily unavailable. Removing the phone deletes the result and timestamps. An older positive result expires in the dashboard after 48 hours | `PUT /api/device/attestation`. Certificate chains are used in memory for verification and never stored in the database or logs |
| Latest position (one row per phone, no history) | until location is switched off or the phone is removed | `locations` |
| Location mode (off, find, checkin, always) and the end of "always" | until the phone is removed; the end is cleared when "always" ends | `phones.location_mode`, `phones.location_always_until` |
| "Ring the phone" and "Are you okay?" (times, the answer, and for "Call me" an approved contact's number; one of each kind per phone) | replaced by the next one; deleted a day after it ended | `safety_requests`, sweeper |
| Pending changes on a Self phone | while pending, then 30 days | sweeper, `CHANGE_HISTORY_DAYS` |
| Address book suggestions from a Child phone (display names and international phone numbers) | pending names and numbers until review, removal from the synced address book, or the parent turning suggestions off. Reviewed numbers stay until the phone is removed to prevent repeat suggestions | `contact_suggestions`, `PUT /api/device/contact-suggestions` |
| Requests from a phone (an app package name, or a contact's name and number) | while open, then 30 days after they are decided | sweeper, `REQUEST_HISTORY_DAYS` |
| Push subscriptions (endpoint at the browser's push service, `p256dh` and `auth` keys, a label such as "Chrome · Android"; or an APNs/FCM token) | until the parent removes the subscription, signs out on the device while connected, or deletes the account. Browser subscriptions are also removed after HTTP 404/410 or 20 consecutive send failures. FCM tokens are also removed when Firebase reports them as unregistered | `push_subscriptions`, `DELETE /api/notifications/subscriptions/{sid}` |
| Per parent and phone: notifications muted (one row when off) | until switched back on, the phone is removed or the account is deleted | `notification_mutes` |
| Per phone (shared by its parents): hours of silence before an alert, and when the last offline alert went out | until the phone is removed | `phones.offline_alert_hours`, `phones.offline_alerted_at` |
| Household invitations | deleted when accepted; otherwise 1 day after they expire (7 days) | sweeper, `INVITE_GRACE_DAYS` |
| Login links | 1 day after they expire | sweeper |
| Sessions | until they expire (60 days) or the user logs out | sweeper |
| Pairings (holds a not yet collected device token in clear text) | 1 day | sweeper |
| ClientIDs the DNS filter must forget | until the DNS service confirms the delete | `dns_deletions`, sweeper |
| Database backups | 30 nightly copies on the hosted service; the sample `compose.yaml` keeps 14 daily and 8 weekly | Dokploy backup (hosted), `backup` service in `compose.yaml` |

The Android call log and SMS/MMS history stay on the phone. Contact suggestions
are off for every Child phone until a parent turns them on in the dashboard.
When enabled, only names and international phone numbers are sent to the parents
in the household. Suggestions use the authenticated HTTPS API and PostgreSQL,
like existing approved contacts. This path does not use end-to-end encryption.
A successful read updates pending suggestions from up to 2,000 of the most
recently updated contacts. Turning suggestions off stops uploads and deletes
undecided names and numbers from the live database. Approved contacts and the
reviewed numbers used to prevent repeat suggestions remain. On Self phones,
the address book stays local and only numbers and names explicitly selected as
favourites are sent as rule changes.

Notifications go to the browser's push service (Google FCM, Apple, Mozilla or
Microsoft; only these hosts are accepted). The payload is encrypted for the
device (RFC 8291) and signed with our VAPID key (RFC 8292), so the push service
sees only the endpoint, the time and the size. Alerts about removed protection
and quiet phones also go out by email to every household member who has not
muted the phone.

For Android parent-app notifications, Firebase receives the registration token,
a generic notification and its type (approval or test). It receives no phone
name, contact details, request content or location in these messages.

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

## Help lines

Plainphone does not send help-line call or SMS records to its server or to the
parent dashboard. Help-line numbers are excluded from the parent-facing
blocked log. Using the Help screen, including opening catalogue links there,
does not contribute to screen time or usage reports.
Time spent viewing a protected site in a separate browser counts as browser
use. See [Help lines](policies.md#help-lines) for when Android hands off links.
Android can still show calls in its own recent calls and keep SMS conversations
on the phone. The reply window uses a timestamp stored only on the phone, and
Help SMS notifications are hidden on the lock screen. Leaving a Help page
clears its WebView cookies and site storage. Calls, messages and websites are
subject to the provider's own privacy practices.

ppdns allows the verified help and information sites through the web filter and
excludes the allowed domains from DNS statistics. Third-party chat services
are matched by exact hostname. As with other lookups, ppdns does not keep a
query log.

## Location on the phone and on the map

How the four location modes work, and what the phone shows the child, is in
[location.md](location.md). In short: a child's phone starts with "Find and an unanswered
\"Are you okay?\"", never "always on"; each single position shows a short notice on the
phone; "always on" shows an ongoing notification and a line on Plainphone's own screen.

The PWA draws the map with MapLibre GL and tiles from OpenFreeMap (`tiles.openfreemap.org`,
OpenStreetMap data). The tiles are loaded only on the location page, and that request tells
OpenFreeMap the area and the parent's IP address. The server's CSP allows that one origin
(`MAP_TILE_ORIGIN` in `server/src/app.ts`). "Drive there" links hand the coordinates to Google
Maps or Apple Maps only when the parent taps them.

## Trusted people and setup codes

A trusted person can see which phone and account they help, pending changes and
the names of the rules they can approve. The helper account receives no
location, messages, contacts, browsing or usage history. A trusted invitation
grants no household membership. Any data the owner explicitly shares through
a separate feature follows that feature's access rules. The dashboard decodes
QR codes in the browser. It sends the code needed for the selected action to
Plainphone, and keeps camera images on the device.

A **Set up like me** code contains a link to a 15-minute snapshot of time limits,
schedules, app choices and web filter categories. It excludes contacts, domain
exceptions, location, history and the key. Importing the snapshot creates no
relationship between the two accounts.
