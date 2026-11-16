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

1. **Pairing.** The phone starts a pairing and shows the 8-character code and a QR code of
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

   The answer is `204`. Invalid bodies get `400`. The parent API returns `rulesAppliedAt` in UTC.
6. **Removed.** `401` on rules means the phone was removed (on a Self phone only after the key
   allowed it). Keep enforcing the last rules and show "pair again"; never loosen on an error.
   A paired phone must not start a new pairing on its own, or a Self user could pair it again
   as a Child phone and leave the key behind.

### Rules the phone enforces

| Field | What the phone does |
|---|---|
| `apps.allowed` / `apps.hidden` | `setApplicationHidden` for hidden; unknown apps stay hidden |
| `contacts` | `CallScreeningService` and SMS filter: only these numbers, plus emergency numbers |
| `schedules` | In a window (phone's `timezone`), only dialer, messages and the `allowedPackages` that are also in `apps.allowed` are visible (a hidden app never shows), plus the core apps. `end < start` crosses midnight; `days` are the start days (ISO, 1 = Monday) |
| `dns.host`, `dns.ready` | Switch with `setGlobalPrivateDnsModeSpecifiedHost(host)` only when `dns.ready` is `true`. Until then keep the current (placeholder) host. The DNS service answers REFUSED for a ClientID it has not accepted yet, so switching early would leave the phone without DNS. `ready` turns `true` once, after the first successful sync, and never goes back to `false`, so the network never dies |
| `location` | See above |
| `pendingChanges` | Self profile: show each with a countdown to `effectiveAt` (null = waiting for the trusted person) |
| `pollSeconds` | Poll interval |

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
