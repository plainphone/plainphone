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
| `schedules` | In a window (phone's `timezone`), only dialer, messages and the `allowedPackages` that are also in `apps.allowed` are visible (a hidden app never shows). `end < start` crosses midnight; `days` are the start days (ISO, 1 = Monday) |
| `dns.host`, `dns.ready` | Switch with `setGlobalPrivateDnsModeSpecifiedHost(host)` only when `dns.ready` is `true`. Until then keep the current (placeholder) host. The DNS service answers REFUSED for a ClientID it has not accepted yet, so switching early would leave the phone without DNS. `ready` turns `true` once, after the first successful sync, and never goes back to `false`, so the network never dies |
| `location` | See above |
| `pendingChanges` | Self profile: show each with a countdown to `effectiveAt` (null = waiting for the trusted person) |
| `pollSeconds` | Poll interval |

### Push (later)

The server has a push abstraction. FCM is the planned layer: the phone registers its token with
`PUT /device/push-token`, and the server sends a data message (`rules` or `locate`) that makes
the phone poll at once. Polling stays the guarantee, so a phone without Google Play Services
works, just slower. No Firebase project exists yet.

## Kotlin client sketch

No dependencies beyond the Android SDK (`HttpURLConnection`, `org.json`), like the rest of the
app. Call it from a background thread or a `WorkManager` worker; never on the main thread.

```kotlin
// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync

import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

class PlainphoneApi(private val baseUrl: String, var deviceToken: String? = null) {

    class Pairing(val id: String, val code: String, val pollSecret: String, val qrUrl: String)
    sealed interface PairPoll {
        object Waiting : PairPoll
        object Expired : PairPoll
        data class Paired(val phoneId: String, val deviceToken: String) : PairPoll
    }
    sealed interface RulesResult {
        object Unchanged : RulesResult
        object Unpaired : RulesResult
        data class Changed(val etag: String, val rules: JSONObject) : RulesResult
    }
    class HttpError(val status: Int, message: String) : Exception(message)

    private class Response(val status: Int, val body: String, val etag: String?)

    private fun call(
        method: String,
        path: String,
        body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(),
    ): Response {
        val conn = URL(baseUrl.trimEnd('/') + "/api" + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.setRequestProperty("Accept", "application/json")
            deviceToken?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val text = stream?.bufferedReader()?.use { it.readText() } ?: ""
            return Response(status, text, conn.getHeaderField("ETag"))
        } finally {
            conn.disconnect()
        }
    }

    fun startPairing(mode: String, deviceInfo: Map<String, String>): Pairing {
        val r = call("POST", "/device/pairings", JSONObject().put("mode", mode).put("deviceInfo", JSONObject(deviceInfo)))
        if (r.status != 201) throw HttpError(r.status, r.body)
        val j = JSONObject(r.body)
        return Pairing(j.getString("pairingId"), j.getString("code"), j.getString("pollSecret"), j.getString("qrUrl"))
    }

    fun pollPairing(p: Pairing): PairPoll {
        val r = call("GET", "/device/pairings/${p.id}", headers = mapOf("X-Poll-Secret" to p.pollSecret))
        return when (r.status) {
            200 -> JSONObject(r.body).let { PairPoll.Paired(it.getString("phoneId"), it.getString("deviceToken")) }
            202 -> PairPoll.Waiting
            404, 410 -> PairPoll.Expired
            else -> throw HttpError(r.status, r.body)
        }
    }

    /** Pass the last stored ETag. Apply [RulesResult.Changed.rules] fully, then store its etag. */
    fun fetchRules(etag: String?): RulesResult {
        val r = call("GET", "/device/rules", headers = etag?.let { mapOf("If-None-Match" to it) } ?: emptyMap())
        return when (r.status) {
            200 -> RulesResult.Changed(r.etag ?: "", JSONObject(r.body))
            304 -> RulesResult.Unchanged
            401 -> RulesResult.Unpaired
            else -> throw HttpError(r.status, r.body)
        }
    }

    data class InstalledApp(val packageName: String, val label: String, val core: Boolean)

    fun reportApps(apps: List<InstalledApp>) {
        val arr = JSONArray()
        apps.forEach { arr.put(JSONObject().put("packageName", it.packageName).put("label", it.label).put("core", it.core)) }
        val r = call("PUT", "/device/apps", JSONObject().put("apps", arr))
        if (r.status != 204) throw HttpError(r.status, r.body)
    }

    data class DeviceStatus(
        val appVersion: String,
        val batteryPct: Int?,
        val charging: Boolean?,
        val deviceOwner: Boolean,
        val lockIntact: Boolean,
        val maintenance: Boolean,
        val failedPolicies: List<String>,
        val rulesEtag: String?,
        val rulesAppliedAtIso: String?,
        val dnsHost: String?,
    )

    fun reportStatus(s: DeviceStatus) {
        val body = JSONObject()
            .put("appVersion", s.appVersion)
            .put("batteryPct", s.batteryPct ?: JSONObject.NULL)
            .put("charging", s.charging ?: JSONObject.NULL)
            .put("deviceOwner", s.deviceOwner)
            .put("lockIntact", s.lockIntact)
            .put("maintenance", s.maintenance)
            .put("failedPolicies", JSONArray(s.failedPolicies))
            .put("rulesEtag", s.rulesEtag ?: JSONObject.NULL)
            .put("rulesAppliedAt", s.rulesAppliedAtIso ?: JSONObject.NULL)
            .put("dnsHost", s.dnsHost ?: JSONObject.NULL)
        val r = call("PUT", "/device/status", body)
        if (r.status != 204) throw HttpError(r.status, r.body)
    }

    /** Returns false when location is off for this phone (stop reporting). */
    fun reportLocation(lat: Double, lon: Double, accuracyM: Float?, recordedAtIso: String): Boolean {
        val body = JSONObject().put("lat", lat).put("lon", lon).put("recordedAt", recordedAtIso)
        accuracyM?.let { body.put("accuracyM", it.toDouble()) }
        val r = call("PUT", "/device/location", body)
        return when (r.status) {
            204 -> true
            409 -> false
            else -> throw HttpError(r.status, r.body)
        }
    }
}
```

Suggested worker loop:

```kotlin
// Every rules.pollSeconds (WorkManager has a 15-minute floor for periodic work, so use a
// foreground-free alarm or a self-rescheduling OneTimeWorkRequest for the 60 s cadence).
when (val r = api.fetchRules(store.etag)) {
    // RulesApplier switches to dns.host only when rules.dns.ready is true.
    is RulesResult.Changed -> { RulesApplier.apply(context, r.rules); store.etag = r.etag }
    RulesResult.Unchanged -> Unit
    RulesResult.Unpaired -> notifyPairAgain() // keep enforcing the last rules
}
```
