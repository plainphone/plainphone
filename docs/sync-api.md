# Phone sync API

How the Plainphone app on the phone talks to the server. The full contract is
[`server/openapi.yaml`](../server/openapi.yaml) (tag `device`); this page explains the flow and
gives a small Kotlin client to start from. A test checks that `openapi.yaml` lists exactly the
routes the server has.

## Connection recovery

The Android sync client reuses HTTP connections. After an eligible I/O failure, it can retry
once through a fresh Android network connection pool with `Connection: close`. Connection
setup failures and timeouts surface immediately, using the usual request deadlines.
`HttpURLConnection` does not expose whether the failed request used an idle pooled socket,
so a new socket that drops mid-exchange can also trigger the recovery.

Ordinary GETs, safety events, release acknowledgements, and Find or check-in location uploads
can use this retry. Safety events only notify on the first recorded answer. Release is
transactional and a repeated acknowledgement can return 401, which the phone already accepts.
Find and check-in uploads replay the original fix and purpose; the server checks the matching
request and can return 409 if it already consumed the upload. Enrollment rotates the device
token on redemption, pairing creation allocates a new pairing, and the legacy pairing poll
consumes the token. Those operations never use the immediate retry.

## Light-mode code pairing and sync

```
phone                                      server                         parent (PWA)
  | POST /device/pairings {mode, profile, confirmOnPhone: true}             |                                  |
  |----------------------------------------->|                                  |
  |  201 {pairingId, code, pollSecret, qrUrl}|                                  |
  |  show code "K7MP-4QXR" + QR of qrUrl     |                                  |
  |                                          |   POST /phones/claim {code,...}  |
  |                                          |<---------------------------------|
  | GET /device/pairings/{id}  (every 3-5 s) |                                  |
  |   X-Poll-Secret: ...                     |                                  |
  |----------------------------------------->|                                  |
  |  202 waiting ... 202 {status: confirm, maskedEmail, householdName}
  | POST /device/pairings/{id} {action: confirm} with X-Poll-Secret
  |  200 {deviceToken}
  |                                          |                                  |
  | PUT /device/apps {apps:[...]}            |                                  |
  | GET /device/rules  If-None-Match: <etag> |   PUT /phones/{id}/apps/...      |
  |  every pollSeconds (60 s)                |<---------------------------------|
  |  304, or 200 + new ETag -> apply         |                                  |
  | PUT /device/location (every 5 min, or    |   POST /phones/{id}/locate       |
  |   at once when location.requestedAt set) |<---------------------------------|
  | PUT /device/status {battery, lock,       |   GET /phones/{id}               |
  |   failedPolicies, ...}                   |   -> status, dnsReady            |
  |----------------------------------------->|                                  |
  |                                          |<---------------------------------|
```

1. **Pairing.** A dashboard setup token goes through [enrollment](#setup-from-the-dashboard).
   Otherwise the phone shows a 15-minute code and a QR code. The dashboard uses the code to
   preselect the phone's profile and the adult submits the claim. In light mode, with `confirmOnPhone: true`,
   a claim creates a pending phone. Polling with the secret returns only the claimer's masked
   email and the household name. The phone sends `{action: "confirm"}` to the same URL to finish
   pairing. Until the first authenticated rules sync, the same secret can recover the token
   for 24 hours from confirmation, even after the 15-minute claim code expires. That first
   sync activates the phone and clears the recovery token. Before confirmation,
   `{action: "cancel"}` removes the pending phone and code. The sweeper removes expired
   unconfirmed claims. Confirmed light phones can still sync or report Undo after their recovery
   code expires. Strong-mode phones receive their device token from GET with the masked
   account and household. If that response is lost, the same poll secret
   recovers the token within 24 hours of the first delivery and before the
   first authenticated rules sync.
   Store the device token in encrypted storage (Android Keystore-backed).
2. **Rules.** Poll `GET /device/rules` with the last `ETag` in `If-None-Match`. `304` means
   nothing changed. On `200`, apply the whole document, then store the new ETag. The document
   is the complete truth; there are no deltas. A release request changes the ETag, so a
   phone polling with its previous ETag receives `200` with `release: true`. See the
   [server benchmark](../server/README.md#measure-the-server-footprint) for polling costs.
3. **Apps.** Send the full list of launchable apps after pairing and whenever packages change
   (`ACTION_PACKAGE_ADDED/REMOVED`). Mark dialer, messages, settings, launcher, keyboard, clock,
   camera and contacts as `core`; they are never hidden. Apps the server has not seen yet are
   hidden by default (unless in the country starter pack).
4. **Location.** Report with `PUT /device/location` (see [location.md](location.md)). Tag each
   upload with `purpose`: `always` for scheduled reports every `location.intervalMinutes`,
   `find:<requestedAt in epoch milliseconds>` for a Find request, or `checkin:<id>` when
   `checkIn.locationDue` is true and the phone's clock has reached the unanswered check-in's
   reply deadline. The server sets that flag from the deadline. Start a separate lookup
   for the check-in and send a fix recorded after `checkIn.createdAt`.
   Retry a saved upload only for its original request. Any unrequested position gets `409`,
   as does every position when location is off. Each tag answers only its matching request.

   An upload without a purpose uses the older routing rules. One fix can serve an
   active Find, an active always session, and an unanswered check-in. The check-in
   accepts uploads from two minutes before its deadline, based on server time.
   A fix clears Find only if recorded at or after the Find request.

   The server holds check-in fixes privately until at least one second after both the reply
   deadline and receipt of the fix. The next sweeper pass publishes the fix if the check-in
   still has no answer and has not been cancelled. A separately authorized Find or always
   position is available immediately.

   Phones from before `mode` only know `enabled`; the server sends them
   `intervalMinutes: 1440` outside `always`. After `location.alwaysUntil`, the server refuses
   scheduled reports and the mode becomes `checkin`.
5. **Ring and "Are you okay?".** `ring` and `checkIn` in the rules are the open requests (null:
   none, or stop). Report what happened with `POST /device/safety/{id}`: `shown`, `here` (ring),
   `ok` or `call` (check-in). While a ring is open or a check-in waits for an answer,
   `pollSeconds` is 10.
6. **Status.** Report battery, app version and lock state with `PUT /device/status`. Send it
   regularly and at once when the lock state or a maintenance unlock changes. The newest report
   replaces the one before (no history), and the parent sees it on the phone's page: battery,
   last sync, app version, and a warning listing `failedPolicies` when `lockIntact` is false.
   These fields are required (use `null` where the type allows it):

   | Field | Meaning |
   |---|---|
   | `appVersion` | App version name, 1 to 40 characters |
   | `batteryPct`, `charging` | 0 to 100 and a boolean, or `null` when unknown |
   | `deviceOwner` | Plainphone is the device owner |
   | `lockIntact` | Every lock policy was applied **and** no maintenance unlock is running |
   | `maintenance` | A PIN maintenance unlock is running on the phone |
   | `failedPolicies` | Names of the lock steps that failed (at most 50, each 1 to 200 characters). The strong-mode entry `battery exemption missing: self-update cannot run` describes update readiness and leaves `lockIntact` unchanged. |
   | `rulesEtag`, `rulesAppliedAt` | ETag of successfully applied rules and the first successful application time (ISO 8601 with a time zone), or `null` |
   | `dnsHost` | The private DNS host the phone actually uses, or `null` |

   These fields are optional, so older phones keep working:

   | Field | Meaning |
   |---|---|
   | `rulesReceiptConfirmed` | True when the ETag and timestamp represent a successful application. Older reports lack this confirmation because their ETag can refer to a fetched document. In light mode with the Private DNS filter, a phone holds the confirmation back until its own check has verified the filter (`filterWorking: true` for `privateDns`) after the parents chose that method. Later rule changes are confirmed even if the filter then breaks, because the phone did apply them; the health card shows the filter problem separately. If the chosen Private DNS filter never verifies, the phone also holds back confirmation of later rule changes until the filter verifies or the method changes; the health card shows why. |
   | `webFilterActive` | The phone observed the configured filter in use (`true`), observed that it was absent (`false`), or could not check (omitted or `null`). Light-mode phones report the method they use in `filterMethod`, `filterWorking` and `filterIssue` instead, and the health card shows that result. Strong-mode phones keep using `webFilterActive`. |
   | `mode` | `strong` or `light`; missing means strong. It does not change the phone's mode, which is decided at pairing |
   | `protections` | What is active now, all booleans: `deviceOwner`, `deviceAdmin`, `accessibility`, `usageAccess`, `usageAccessGranted`, `vpn`, `alwaysOnVpn`, `phoneRole`, `smsRole`, `notifications`, `batteryUnrestricted`, `privateDnsOk`. Any other key is a `400` |
   | `timeUsed` | Minutes used today per limited package, `"*"` for the total; at most 200 entries, each 0 to 1440 |

   In light mode `lockIntact` means: `deviceAdmin`, `accessibility`, `usageAccess`, `vpn`,
   `phoneRole` and `smsRole` are all on, no policy failed and no maintenance unlock runs. For a
   phone paired in light mode, or a report with `mode: "light"`, the server stores
   `lockIntact: false` when `protections` is missing, one of those six is off or missing, a
   policy failed or maintenance runs, whatever the phone sent. For compatibility,
   `usageAccess` is true when permission is granted or there are no time limits.
   `usageAccessGranted` is the actual Android permission. Older phones omit it.

   The answer is `204`. Invalid bodies get `400`. A valid report with an ahead
   clock is still stored. The confirmation compares the reported ETag to the
   current rules ETag, and the parent API returns timestamps in UTC. The dashboard
   labels the server's confirmation time when the phone clock is ahead.
   The parent's per-phone `changeReceiptsEnabled` and `healthBoardEnabled`
   preferences default to true and sync in `GET /device/rules`. So does
   `weeklySummaryEnabled` (docs/weekly-summary.md): the server keeps this phone's
   daily `timeUsed` for the weekly summary only while it is true. The phone keeps reporting as before and
   uses it only to tell the child on "What can my parents see?"; a change advances the revision so the
   notice follows. Android sends
   null rule confirmation fields when receipts are off and omits the extra
   filter and usage access observations when the board is off. The phone
   continues sending existing operational status and safety reports.
   The per-phone `silentBedtime` (default on) and `pinApprovalEnabled` (default on, always false on a
   Self phone) switches also sync in `GET /device/rules` ([bedtime.md](bedtime.md)). A missing
   `silentBedtime` means on; a missing `pinApprovalEnabled` means off, because an older server has no
   endpoint for the report below.
   Rule edits advance the revision even if they restore an earlier configuration.
   A DNS edit waits for the resolver to accept it and for the phone to acknowledge
   the resulting ETag. A later phone-side edit can be confirmed during a resolver
   outage. The filter screen still shows the resolver's sync status.
   In Light mode a VPN start request is provisional until the tunnel is running
   with the requested resolver.
6. **Removed.** `401` on rules means the phone was removed (on a Self phone only after the key
   allowed it). Keep enforcing the last rules and show "pair again"; never loosen on an error.
   A paired phone must not start a new pairing on its own, or a Self user could pair it again
   as a Child phone and leave the key behind.

### Setup from the dashboard

The parent adds a phone in the dashboard before the phone is set up:

```
parent (PWA)                                server                          phone
  | POST /phones/enroll {name, profile, mode}       |                                 |
  |------------------------------------------>|  phone entry (pairedAt null)    |
  |  201 {phone, enrollment{token,expiresAt}, |  + DNS ClientID registered      |
  |       provisioning{downloadUrl, ...}}     |                                 |
  |  hash PIN in the browser, show the QR ----------------- scanned at setup ----->|
  |                                           |  POST /device/enroll            |
  |                                           |  {token, installId, deviceInfo} |
  |                                           |<--------------------------------|
  |  GET /phones/{id} -> pairedAt set         |  200 {phoneId, deviceToken}     |
```

- In strong mode the provisioning QR code holds what `scripts/provisioning-qr.py` puts in it (admin component, signature
  checksum, download URL, PIN hash and salt, country code, and the server and start DNS when they
  differ from the app's defaults) plus `plainphone.enroll`. The browser hashes the PIN with the
  script's parameters (PBKDF2-HMAC-SHA256, 120,000 iterations, 32 bytes, 16-byte salt); the shared
  test vector is in `web/src/lib/provisioning.test.ts`, `MaintenancePinTest.kt` and
  `scripts/test_provisioning_qr.py`. The server stores no PIN and no PIN hash.
- In light mode the QR code opens `/install-phone` with the token, Android package and language in
  the URL fragment. The page removes the fragment from the current history entry and uses the
  token in a package-scoped Android intent. The parent enters the PIN twice in the app, which
  salts and hashes it locally. The phone first calls `POST /device/enrollment-review` with the
  setup token and mode. The response identifies the profile, household and masked issuer. Sending
  `cancel: true` instead removes the unused phone and token. Strong mode redeems the dashboard
  token automatically. Its enrollment response includes the masked issuer and household, when
  available, for an informational notice on the phone.
- `mode` defaults to `strong` for existing clients. Enrollment keeps the selected mode on
  the phone entry. The phone separately reports what Android granted in its protection status.
- The token (`pp_e_` + 128 random bits) is stored as a SHA-256 hash, works once, expires after
  24 hours and is bound to the phone entry. `POST /phones/{pid}/enrollment` makes a new one for a
  phone that is not set up yet; older tokens for it stop working.
- Superseded tokens return `410` with `code: outdated_qr`. When redemption first detects
  a configuration mismatch it invalidates the token and returns `409`. Enrollment cleanup
  can remove token hashes and their snapshots starting 30 days after expiry.
- If a strong provisioning token receives `404`, `409` or `410`, the phone saves the rejection
  and asks for a factory reset and a new QR code. A superseded light setup link asks for a
  new link. If the `200` answer is lost, the same phone (same `installId`) may ask again
  for 60 minutes and gets a new device token.
- Code pairing keeps working, for QR codes made with the script and for self-hosters.
- A phone entry that was never set up can be removed at once, also on a Self phone (there is no
  key to escape from yet).

**Undo light-mode setup.** The phone decides whether the window is open using elapsed time
on the boot when setup completed. After switching off locally, it sends an authenticated
`POST /device/undo-setup`. In one transaction the server removes the phone and queues the
standard protection-removed notice, which says setup was undone on the phone. The sweeper
retries failed deliveries. The phone retries the report until it gets `204` (removed) or
`401` with `{"error":"unknown device; pair again"}` (pairing already gone). A `404` from
an older server can mean the route is missing, so the phone keeps retrying. Repeated
reports cannot enqueue a second notice.

**Stable download address.** `downloadUrl` is `<PUBLIC_URL>/download/android`, outside `/api`. It
answers `302` to the newest published (pre-)release APK on GitHub (`APK_RELEASES_REPO`), looked up
at most every 10 minutes and kept when GitHub is unreachable, or to `APK_DOWNLOAD_URL` when a
self-hoster sets it. Android's provisioning downloader follows redirects. The QR code pins the
signing certificate (`APK_SIGNATURE_CHECKSUM`), not the file, so a QR code keeps working across
releases signed with the same key.

### Rules the phone enforces

| Field | What the phone does |
|---|---|
| `apps.allowed` / `apps.hidden` | `setApplicationHidden` for hidden; unknown apps stay hidden |
| `apps.open` / `apps.blocked` | Open mode ([open-mode.md](open-mode.md)). With `open: true`, allow every app that is not in `blocked`, also apps installed after the last sync. `blocked` includes the known apps of blocked categories that are not installed yet. A school time or bedtime window wins. Missing from older servers: the allow-list applies |
| `apps.toInstall` | Apps the parent added from the [catalog](app-catalog.md) that are not installed yet (`packageName`, `label`). Treat them as allowed, so they are not hidden the moment they are installed, and offer to install them: strong mode opens Play for that one app, light mode links to Play |
| `timeLimits` | Daily limits, always present. `total` (all non-core apps together, or `null`), `apps` (per package), `bonuses` (today and tomorrow only). See [time-limits.md](time-limits.md) |
| `askMoreTimeEnabled`, `limitWarningEnabled` | Per-phone switches for the stop screen's "Ask for more time" button and the 5-minute warning. Missing means `true`. See [more-time.md](more-time.md) |
| `sos.hidden`, `sos.quickMessages` | Child phones only. Hidden SOS switches (`power`, `presses`, `clock`, `feedback`) and the quick messages (`enabled`, `suggest`, `items` with `meansSos` for a code word). Missing means off and no messages. See [sos.md](sos.md) |
| `inbox` | Child phones only, and only while the [family inbox](family-inbox.md) is on: `enabled`, `quickMessages`, `checkIns` and `latest` (the newest parent reply; when it changes the phone fetches `GET /device/inbox` and sends its receipt). Missing means off |
| `contacts` | `CallScreeningService` and SMS filter: only these numbers, plus emergency numbers |
| `language` | Plainphone UI language: `da`, `en`, `sv`, `nb`, `de` or `null` to follow Android. |
| `schedules` | In a window (phone's `timezone`), only dialer, messages and the `allowedPackages` that are also in `apps.allowed` are visible (a hidden app never shows), plus the core apps. `end < start` crosses midnight; `days` are the start days (ISO, 1 = Monday) |
| `dns.host`, `dns.ready` | Switch with `setGlobalPrivateDnsModeSpecifiedHost(host)` only when `dns.ready` is `true`. Until then keep the current (placeholder) host. The DNS service answers REFUSED for a ClientID it has not accepted yet, so switching early would leave the phone without DNS. `ready` stays `true` for previously confirmed phones during upgrades and retries. A confirmation from the mock provider requires a fresh sync when switching to HTTP DNS |
| `dns.privateDnsReady` | Required before offering manual Private DNS setup. True only when the currently configured DoT service has accepted this phone’s ClientID. Mock confirmations and older rules without this field leave setup waiting |
| `location` | `enabled`, `mode`, `intervalMinutes`, `requestedAt`; see above |
| `ring`, `checkIn` | See above and [location.md](location.md) |
| `settings` | Phone settings that are not free (camera, screen timeout, Bluetooth and so on), keys in alphabetical order. Applied only in strong mode. See [phone-settings.md](phone-settings.md) |
| `home` | The home screen: `layout`, `theme`, `palette` and the ordered front-page `apps`. A missing field means the defaults |
| `pendingChanges` | Self profile: show each with a countdown to `effectiveAt` (null = waiting for the trusted person) |
| `release` | `true` once the parents have released the phone. Switch Plainphone off, never lock again, then acknowledge with `POST /device/released`. See [Releasing the phone](#releasing-the-phone). A missing field means `false` (an older server) |
| `pollSeconds` | Poll interval |

### Releasing the phone

A parent can switch Plainphone off on a phone from the dashboard (**Release the phone**,
`POST /api/phones/{pid}/release`). It has the same effect as the maintenance screen's "Release
Device Owner" in strong mode, or "Switch Plainphone off" in light mode: the lock and the filters
stop, and Plainphone is an ordinary app that can be uninstalled. This is different from
`DELETE /api/phones/{pid}`, which only deletes the phone on the server and leaves the lock where it is.

1. On a Child phone the change applies at once. On a Self phone it waits for the key like any
   other loosening, so the phone first shows it under `pendingChanges` (`op.type` is
   `phone.release`). A phone that never paired answers `400`: remove it instead.
2. When the rules say `release: true`, the phone does this before anything else, and does not
   apply the lock again: cancel any relock, then release (strong mode: policies cleared, home
   screen preference cleared, Device Owner given up; light mode: device admin off, VPN stopped,
   guard off). It then remembers on its own that it has released, so a failed acknowledgement
   never leads to a new lock.
3. It tells the server with `POST /api/device/released`. `204` means the phone is deleted on the
   server (its DNS ClientID is queued for deletion). `401` means the same, already done. `409`
   means the server has no release on record for this phone (it should not happen, since a
   requested release is only cleared by deleting the phone); nothing was deleted, and the phone
   forgets the release and syncs normally. On a network error, send it again at the next sync.
   The phone only acts on stored rules whose `phoneId` is its current one, so rules kept from an
   earlier pairing never release it.
4. On `204` or `401` the phone treats itself as removed and shows nothing new.

Until the phone has done this, the dashboard shows the phone as "Releasing" (`releaseRequestedAt`
on the phone summary). A phone that is switched off or offline keeps its lock until it connects.
To remove such a phone from the dashboard without releasing it, use `DELETE /api/phones/{pid}`.

Light-mode setup undo switches protection off locally. `POST /api/device/undo-setup` removes
the phone and queues an undo notice when the authenticated report arrives, including after a
long offline period or before the first rules sync. A report received more than 48 hours after
a recorded undo window ends is marked late in the notice. The phone retries until the server
acknowledges the report or confirms the pairing is gone with the unknown-device response.
The separate `POST /api/device/setup-completion` report provides the dashboard deadline and
the timing for the notice. Its elapsed age comes from the current boot and is capped at seven days on the server.
A phone that rebooted before reporting sends a null age.

### Requests (asking for an app or a contact)

Spec 4 and 5: the person with the phone can ask for something the parents then approve or
decline. The phone lists its requests under **My requests** and can approve a waiting one with the
parent PIN ([bedtime.md](bedtime.md)); asking from the phone is not built yet, the server side is.

- `POST /api/device/requests` with `{ "kind": "app", "packageName": "com.spotify.music" }` or
  `{ "kind": "contact", "name": "Gran", "number": "+4512345678" }`.
  - An app must be on the phone's own list (`PUT /device/apps`), installed and hidden.
    `404` if it is not on the list, `409` if it is already allowed (or a core app).
  - A contact number is normalised to E.164 (spaces, dashes and brackets are dropped); `409`
    if it is already an approved contact. `400` for a number without `+` and country code.
  - `201` with the request. Asking again for the same thing while it is open gives `200` with
    the same request, and the parents are not notified twice.
  - At most 10 open requests per phone (`429`). Show "wait for an answer" rather than retrying.
- The parents get a push notification. Approving is an ordinary rule change: the app becomes
  allowed, or the contact is added. On a Self phone the approval waits for the key like any
  other loosening, so the phone shows it under `pendingChanges` too.
- `GET /api/device/requests` lists open requests and those answered in the last 30 days,
  newest first: `{ id, kind, packageName, name, number, status: pending|approved|rejected,
  createdAt, decidedAt, waitingForKey, effectiveAt }`. `waitingForKey` is true for an approved
  request on a Self phone whose change still waits (`effectiveAt` is its time, or null for a
  trusted person). Poll it when the request screen is open; the rules poll already brings the
  effect of an approval. After 30 days answered requests are deleted. `decidedVia` is `"phone"` for an
  approval given on the phone with the PIN, `"parent"` for an answer from the dashboard or the parent app,
  and null while the request is open.
- `POST /api/device/requests/{id}/approve-on-phone` (no body) reports that a parent approved the request
  on the phone with the parent PIN. The phone checked the PIN itself and is the authority for what it
  did, so this is a report: it is applied like a parent's approval (the app is shown, the contact is
  added), the parents are told it happened on the phone, and it is recorded even if the parent switched
  `pinApprovalEnabled` off a moment ago. First answer wins and a repeat changes nothing: the answer is
  `200` with the request as it stands and `won: false` if someone else answered first (for example a
  parent in the dashboard). The id can also be a request for more time (below): then 15 minutes are
  granted for that app or the daily cap, `decidedVia` is `"phone"`, and the body is the more-time request. `404` for a request the phone does not have, `409` on a Self phone (no
  parent PIN) or when the change could not be applied (the request stays open). Offline, the phone
  keeps the approval and reports it with the next sync.
- A parent who answers a request that was already answered gets `409` with `outcome`
  (`approvedByYou`, `approvedByOther`, `approvedOnPhone`, `declinedByYou`, `declinedByOther`), the
  same vocabulary as the approval outcomes in the dashboard and the parent app.

### Asking for more time

The stop screen of a child phone can ask for more time on a used-up app or on the daily cap.
Full description: [more-time.md](more-time.md).

- `POST /api/device/more-time-requests` with `{ "packageName": "*" | "com.spotify.music", "reason": "optional, up to 140 characters" }`.
  `*` is the daily cap (use it when the total is used up, otherwise the app). `201` with the
  request; asking again for the same target while it is open gives `200` and no second push.
  `403` when the parents switched asking off (`askMoreTimeEnabled` in the rules), `409` on a Self
  phone or when the target has no limit, `429` after 6 new requests in an hour.
- `GET /api/device/more-time-requests` returns the last 24 hours, newest first: `{ id, packageName,
  reason, day, status: pending|approved|declined|expired, answer: "15"|"60"|"day"|"no"|null,
  grantedMinutes, createdAt, decidedAt, decidedVia }`. `decidedVia` is `"phone"` for an approval on the phone with the PIN. An unanswered request expires at the phone's local
  midnight.
- An approval is also a bonus in `timeLimits.bonuses` for the day of the request, so the phone
  applies it from the next rules sync (the server wakes the phone when it is answered) even if the
  request call was lost. Show the new end time from your own evaluation of the limits, not from
  the answer. `answer: "day"` means the rest of the day.
- A request is a question, not a report of something that happened, so the server may refuse it
  (`403`, `409`, `429` above). Do not queue a refused request and resend it; show the refusal and
  let the child try again later. A request that failed only because the phone was offline can be
  sent when it is back online.

### Push wakeups

`GET /device/rules` includes the preferred `pushProvider` and whether `unifiedPushAvailable` is true. Both reflect the server policy and the per-phone **Faster rule updates** setting, which defaults to off. **Wakeups without Google** limits the phone to UnifiedPush or polling. Older servers imply polling.

The phone sends `PUT /device/push-token` with `{ "fcmToken": "…" }` for FCM, `{ "unifiedPushEndpoint": "https://…" }` for UnifiedPush or `{ "fcmToken": null }` to clear both. The server validates a new FCM token before replacing the active registration. Previously stored tokens are validated again after upgrade or a Firebase project change. The optional `fcmValidationKey` in the rules invalidates the Android registration cache when the project or validation version changes. On a definitive rejection (422) or temporary validation failure (503), Android tries a configured UnifiedPush endpoint when available. UnifiedPush endpoints must use HTTPS and a configured service host. The phone reports the registered transport as `pushProvider` in `PUT /device/status`. The dashboard shows that report, and a disabled setting immediately clears the stored registration.

FCM uses high-priority data messages. UnifiedPush uses a POST with the same JSON fields. The only payload is `{"wake":"rules"}` (or `locate`, `update`, `sos-ack`). A wake schedules the ordinary authenticated sync. It cannot apply a rule, request a fresh fix, or acknowledge an SOS by itself. The SOS branch can pass `{ urgent: true }` to `notifyHousehold` for parent delivery and use the reserved `sos-ack` reason after it stores the acknowledgement. Existing periodic and interactive polling remain active.

## The phone's implementation

The Android app implements this API in
[`android/app/src/main/java/org/plainphone/app/sync/`](../android/app/src/main/java/org/plainphone/app/sync):
`PlainphoneApi.kt` is the HTTP client (no dependencies beyond the Android SDK), `SyncRunner.kt`
one sync, `PairingController` in `Pairing.kt` the pairing, and `AndroidSync.kt` the WorkManager
scheduling, location and status. How it behaves is described in [phone-sync.md](phone-sync.md).
[`scripts/e2e-phone-sync.sh`](../scripts/e2e-phone-sync.sh) runs that code against the real
server and PostgreSQL, also in CI.


### Phone app updates

`POST /api/phones/{pid}/update` stores `update.requestedAt` in the phone's rules and
wakes it through `GET /api/device/update-request?after=<epoch-ms>` while the phone
process is connected. The same request is also delivered by rules sync if Android
suspends the process or either end loses its connection. The phone saves the most recently queued request to avoid doing
the same work on every poll. `PUT /api/device/status` reports `appVersion`,
`appVersionCode` and the optional latest outcome in `update`.
`GET /download/android/latest.json` describes the release before the phone downloads
the binary. See [Android updates](android-updates.md).

### Updates of approved apps (strong mode)

The rules carry `appUpdates`: `automatic` (the per-phone toggle, default on), `requestedAt`
(set by `POST /api/phones/{pid}/app-updates`, "Update apps now"), `reportedWindow` and
`recordedApps`. The
phone reports its last window in `PUT /device/status` as `appUpdates`: `id`, `trigger`
(`night` or `parent`), `openedAt`, `closedAt`, `updated` (count), `caught` (new packages it
hid) and an optional `error`. The server always records it; for each caught package it has
not recorded for that `id` yet it creates an app request (blocking the app in open mode), sets
`reportedWindow` to the id and `recordedApps` to the packages recorded for it, and advances
the rules revision. The phone stops holding back exactly the packages in `recordedApps`, so an
app caught later in the same window, or carried over from an earlier window the server never
heard about, still becomes a request. Older servers send no `appUpdates`: the phone keeps the nightly
window on. See [Policies, App updates](policies.md#app-updates-strong-mode).

### Platform and capabilities

Phone summaries (`GET /phones`, `GET /phones/{pid}`) include `platform` (`android` or `ios`;
every existing phone is `android`), `tier` (Android: the mode, `strong` or `light`; iPhone:
`family_controls` or `supervised`) and `capabilities`, which says `yes`, `partial` or `no` per
feature for that platform and tier. Clients show a short line under a rule that an iPhone cannot
fully do. The table and the iPhone plan are in [ios/architecture.md](ios/architecture.md#capability-map).
Older servers send none of the three: treat the phone as Android.

### Support tools

`PATCH /phones/{pid}` accepts `supportEnabled` and `releaseWarningsEnabled`
(both default to `true`). They sync via `GET /device/rules`. It also accepts
`askMoreTimeEnabled` and `limitWarningEnabled` (default `true`, missing means `true` on the
phone), which switch the stop screen's "Ask for more time" button and the 5-minute warning
([more-time.md](more-time.md)). The support
setting controls help and diagnostics in Android Maintenance. The warning
setting controls extra status reports after failed remote release attempts.
Phones can include a numeric `androidVersion` string in `PUT /device/status`.
Phone summaries include that version when available and `releaseSyncCount`,
a counter capped at three for rules fetches during a pending release. See
[support tools and release troubleshooting](support.md).

### Moving between servers

`GET /device/rules` carries `allowServerMove` and, during an approved move, a
`move` instruction with an HTTPS `serverUrl` and one-time `token`. The phone
must obey the switch and keep syncing the old server until the move succeeds.

The phone sends the token and a new, phone-generated device credential to
`POST /device/move` on the destination. The server consumes the token once.
The phone can recover from a lost response using that same credential with
`GET /device/move-rules`. It compares protection, verifies the filter over
DNS-over-TLS, then stores the server, credential, and rules together. The
first ordinary `GET /device/rules` confirms the new connection. See the
[household move guide](self-hosting.md#move-to-your-own-server).
