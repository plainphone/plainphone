# Phone sync API

How the Plainphone app on the phone talks to the server. The full contract is
[`server/openapi.yaml`](../server/openapi.yaml) (tag `device`); this page explains the flow and
gives a small Kotlin client to start from. A test checks that `openapi.yaml` lists exactly the
routes the server has.

## Flow

```
phone                                      server                         parent (PWA)
  | POST /device/pairings {mode}             |                                  |
  |----------------------------------------->|                                  |
  |  201 {pairingId, code, pollSecret, qrUrl}|                                  |
  |  show code "K7MP-4QXR" + QR of qrUrl     |                                  |
  |                                          |   POST /phones/claim {code,...}  |
  |                                          |<---------------------------------|
  | GET /device/pairings/{id}  (every 3-5 s) |                                  |
  |   X-Poll-Secret: ...                     |                                  |
  |----------------------------------------->|                                  |
  |  202 waiting ... 200 {deviceToken}       |  (token is handed out once)      |
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

1. **Pairing.** A QR code made in the dashboard carries a one-time enrollment token (see
   [Setup from the dashboard](#setup-from-the-dashboard) below): the phone pairs with it by itself.
   Otherwise the phone starts a pairing and shows the 8-character code and a QR code of
   `qrUrl`. The parent's phone camera opens the PWA with the code filled in. Codes live 15
   minutes. The phone polls with its `pollSecret`; the device token comes back exactly once
   (`410` afterwards). Store it in encrypted storage (Android Keystore-backed).
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
   Every field is required (use `null` where the type allows it):

   | Field | Meaning |
   |---|---|
   | `appVersion` | App version name, 1 to 40 characters |
   | `batteryPct`, `charging` | 0 to 100 and a boolean, or `null` when unknown |
   | `deviceOwner` | Plainphone is the device owner |
   | `lockIntact` | Every lock policy was applied **and** no maintenance unlock is running |
   | `maintenance` | A PIN maintenance unlock is running on the phone |
   | `failedPolicies` | Names of the lock steps that failed (at most 50, each 1 to 200 characters) |
   | `rulesEtag`, `rulesAppliedAt` | ETag of the rules the phone last applied and when (ISO 8601 with a time zone; `400` if more than 5 minutes ahead of the server), or `null` |
   | `dnsHost` | The private DNS host the phone actually uses, or `null` |

   Three fields are optional, so older phones keep working:

   | Field | Meaning |
   |---|---|
   | `mode` | `strong` or `light`; missing means strong. It does not change the phone's mode, which is decided at pairing |
   | `protections` | What is active now, all booleans: `deviceOwner`, `deviceAdmin`, `accessibility`, `usageAccess`, `vpn`, `alwaysOnVpn`, `phoneRole`, `smsRole`, `notifications`, `batteryUnrestricted`, `privateDnsOk`. Any other key is a `400` |
   | `timeUsed` | Minutes used today per limited package, `"*"` for the total; at most 200 entries, each 0 to 1440 |

   In light mode `lockIntact` means: `deviceAdmin`, `accessibility`, `usageAccess`, `vpn`,
   `phoneRole` and `smsRole` are all on, no policy failed and no maintenance unlock runs. For a
   phone paired in light mode, or a report with `mode: "light"`, the server stores
   `lockIntact: false` when `protections` is missing, one of those six is off or missing, a
   policy failed or maintenance runs, whatever the phone sent. The parent sees the protections on the phone's page.

   The answer is `204`. Invalid bodies get `400`. The parent API returns `rulesAppliedAt` in UTC.
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
  salts and hashes it locally. After the required permissions are granted, the app sends the
  token and ordinary enrollment metadata.
- `mode` defaults to `strong` for existing clients. Enrollment keeps the selected mode on
  the phone entry. The phone separately reports what Android granted in its protection status.
- The token (`pp_e_` + 128 random bits) is stored as a SHA-256 hash, works once, expires after
  24 hours and is bound to the phone entry. `POST /phones/{pid}/enrollment` makes a new one for a
  phone that is not set up yet; older tokens for it stop working.
- `404` (unknown) and `410` (used, expired, or the entry is already paired) are final: the phone
  drops the token. Strong setup falls back to code pairing. A phone using the light setup link asks the parent for a new link. If the `200` answer is lost, the same
  phone (same `installId`) may ask again for 60 minutes and gets a new device token.
- Code pairing keeps working, for QR codes made with the script and for self-hosters.
- A phone entry that was never set up can be removed at once, also on a Self phone (there is no
  key to escape from yet).

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
| `apps.toInstall` | Apps the parent added from the [catalog](app-catalog.md) that are not installed yet (`packageName`, `label`). Treat them as allowed, so they are not hidden the moment they are installed, and offer to install them: strong mode opens Play for that one app, light mode links to Play |
| `timeLimits` | Daily limits, always present. `total` (all non-core apps together, or `null`), `apps` (per package), `bonuses` (today and tomorrow only). See [time-limits.md](time-limits.md) |
| `contacts` | `CallScreeningService` and SMS filter: only these numbers, plus emergency numbers |
| `schedules` | In a window (phone's `timezone`), only dialer, messages and the `allowedPackages` that are also in `apps.allowed` are visible (a hidden app never shows), plus the core apps. `end < start` crosses midnight; `days` are the start days (ISO, 1 = Monday) |
| `dns.host`, `dns.ready` | Switch with `setGlobalPrivateDnsModeSpecifiedHost(host)` only when `dns.ready` is `true`. Until then keep the current (placeholder) host. The DNS service answers REFUSED for a ClientID it has not accepted yet, so switching early would leave the phone without DNS. `ready` turns `true` once, after the first successful sync, and never goes back to `false`, so the network never dies |
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

### Requests (asking for an app or a contact)

Spec 4 and 5: the person with the phone can ask for something the parents then approve or
decline. The phone UI for this is not built yet; the server side is.

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
  effect of an approval. After 30 days answered requests are deleted.

### Push (later)

The server has a push abstraction. FCM is the planned layer: the phone registers its token with
`PUT /device/push-token`, and the server sends a data message (`rules` or `locate`) that makes
the phone poll at once. Polling stays the guarantee, so a phone without Google Play Services
works, just slower. No Firebase project exists yet.

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
