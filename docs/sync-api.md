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
   is the complete truth; there are no deltas.
3. **Apps.** Send the full list of launchable apps after pairing and whenever packages change
   (`ACTION_PACKAGE_ADDED/REMOVED`). Mark dialer, messages, settings, launcher, keyboard, clock,
   camera and contacts as `core`; they are never hidden. Apps the server has not seen yet are
   hidden by default (unless in the country starter pack).
4. **Location.** When `location.enabled`, report every `intervalMinutes`, and at once when
   `location.requestedAt` is set (a parent pressed Find). When it is off, the server answers
   `409` and the phone should stop.
5. **Status.** Report battery, app version and lock state with `PUT /device/status`. Send it
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
  | POST /phones/enroll {name, profile}       |                                 |
  |------------------------------------------>|  phone entry (pairedAt null)    |
  |  201 {phone, enrollment{token,expiresAt}, |  + DNS ClientID registered      |
  |       provisioning{downloadUrl, ...}}     |                                 |
  |  hash PIN in the browser, show the QR ----------------- scanned at setup ----->|
  |                                           |  POST /device/enroll            |
  |                                           |  {token, installId, deviceInfo} |
  |                                           |<--------------------------------|
  |  GET /phones/{id} -> pairedAt set         |  200 {phoneId, deviceToken}     |
```

- The QR code holds what `scripts/provisioning-qr.py` puts in it (admin component, signature
  checksum, download URL, PIN hash and salt, country code, and the server and start DNS when they
  differ from the app's defaults) plus `plainphone.enroll`. The browser hashes the PIN with the
  script's parameters (PBKDF2-HMAC-SHA256, 120,000 iterations, 32 bytes, 16-byte salt); the shared
  test vector is in `web/src/lib/provisioning.test.ts`, `MaintenancePinTest.kt` and
  `scripts/test_provisioning_qr.py`. The server stores no PIN and no PIN hash.
- The token (`pp_e_` + 128 random bits) is stored as a SHA-256 hash, works once, expires after
  24 hours and is bound to the phone entry. `POST /phones/{pid}/enrollment` makes a new one for a
  phone that is not set up yet; older tokens for it stop working.
- `404` (unknown) and `410` (used, expired, or the entry is already paired) are final: the phone
  drops the token and falls back to the code pairing above. If the `200` answer is lost, the same
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
| `location` | See above |
| `pendingChanges` | Self profile: show each with a countdown to `effectiveAt` (null = waiting for the trusted person) |
| `pollSeconds` | Poll interval |

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
