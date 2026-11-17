// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.os.CancellationSignal
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import org.json.JSONArray
import org.json.JSONObject

/** The phone's side of the sync API (server/openapi.yaml, tag "device"). Faked in unit tests. */
interface SyncApi {
    fun startPairing(mode: String, deviceInfo: Map<String, String>): Pairing
    fun pollPairing(pairingId: String, pollSecret: String): PairPoll
    /** Pairs with the one-time token from a dashboard-made provisioning QR code (POST /device/enroll). */
    fun enroll(token: String, installId: String, deviceInfo: Map<String, String>): EnrollResult
    fun fetchRules(token: String, etag: String?): RulesResult
    fun reportApps(token: String, apps: List<InstalledApp>)
    /** False when location is off for this phone (the server answers 409). */
    fun reportLocation(token: String, fix: LocationFix): Boolean
    fun reportStatus(token: String, status: DeviceStatus)
    /**
     * Tells the server Plainphone is switched off after a release (POST /device/released). True when
     * the server deleted the phone (204) or no longer knows it (401); false when nobody asked for a
     * release (409). Other answers and network errors throw.
     */
    fun ackReleased(token: String): Boolean
    /**
     * Tells the server what happened to a ring or an "Are you okay?" (`shown`, `here`, `ok`, `call`).
     * False when the server no longer knows the request (404) or refuses the event (400): drop it.
     */
    fun reportSafety(token: String, requestId: String, event: String): Boolean
}

data class Pairing(val id: String, val code: String, val pollSecret: String, val qrUrl: String, val expiresAtMs: Long)

sealed interface PairPoll {
    data object Waiting : PairPoll
    data object Expired : PairPoll
    data class Paired(val phoneId: String, val deviceToken: String) : PairPoll
}

sealed interface EnrollResult {
    data class Paired(val phoneId: String, val deviceToken: String) : EnrollResult
    /** The server refused the token for good (unknown, used, expired): pair with a code instead. */
    data object Rejected : EnrollResult
}

sealed interface RulesResult {
    data object Unchanged : RulesResult
    /** 401: the phone was removed in the dashboard (or never paired). */
    data object Unpaired : RulesResult
    data class Changed(val etag: String, val body: String) : RulesResult
}

data class InstalledApp(val packageName: String, val label: String, val core: Boolean)

data class LocationFix(val lat: Double, val lon: Double, val accuracyM: Float?, val recordedAtMs: Long)

/** What the parent sees about the phone (spec: battery, last sync, version, is the lock intact). */
data class DeviceStatus(
    val appVersion: String,
    val batteryPct: Int?,
    val charging: Boolean?,
    val deviceOwner: Boolean,
    val lockIntact: Boolean,
    val maintenance: Boolean,
    val failedPolicies: List<String>,
    val rulesEtag: String?,
    val rulesAppliedAtMs: Long?,
    val dnsHost: String?,
    val appVersionCode: Long? = null,
    val update: org.plainphone.app.update.UpdateReport? = null,
    val mode: String = "strong",
    val protections: Map<String, Boolean>? = null,
    val timeUsed: Map<String, Int>? = null,
) {
    fun toJson(): JSONObject = JSONObject()
        .put("appVersion", appVersion.take(40))
        .put("batteryPct", batteryPct?.coerceIn(0, 100) ?: JSONObject.NULL)
        .put("charging", charging ?: JSONObject.NULL)
        .put("deviceOwner", deviceOwner)
        .put("lockIntact", lockIntact)
        .put("maintenance", maintenance)
        .put("failedPolicies", JSONArray(failedPolicies.take(50).map { it.take(200) }))
        .put("rulesEtag", rulesEtag?.take(100) ?: JSONObject.NULL)
        .put("rulesAppliedAt", rulesAppliedAtMs?.let { iso(it) } ?: JSONObject.NULL)
        .put("dnsHost", dnsHost?.take(253) ?: JSONObject.NULL)
        .put("mode", mode)
        .apply {
            // Optional fields (docs/sync-api.md): only sent when known.
            protections?.let { put("protections", JSONObject(it)) }
            timeUsed?.let { used -> put("timeUsed", JSONObject(used.entries.take(200).associate { it.key to it.value.coerceIn(0, 1440) })) }
            appVersionCode?.let { put("appVersionCode", it) }
            update?.let { put("update", it.toJson()) }
        }
}

internal fun iso(ms: Long): String = java.time.Instant.ofEpochMilli(ms).toString()

/** HTTP error that is not a network failure: the server answered, but not as expected. */
class HttpError(val status: Int, message: String) : IOException("HTTP $status: ${message.take(200)}")

/**
 * Plain [HttpURLConnection] client, no dependencies. Blocking: call it from a worker thread.
 * Network failures surface as [IOException]; nothing here ever changes the lock.
 */
class PlainphoneApi(baseUrl: String) : SyncApi {
    private companion object {
        // Disconnect can block on I/O. Keep it off the screen broadcast thread.
        val disconnects = Executors.newSingleThreadExecutor()
    }

    private val base = baseUrl.trimEnd('/') + "/api"

    private class Response(val status: Int, val body: String, val etag: String?)

    private fun call(
        method: String,
        path: String,
        token: String? = null,
        body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(),
        readTimeoutMs: Int = 30_000,
        cancellation: CancellationSignal? = null,
    ): Response {
        val conn = URL(base + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.connectTimeout = 15_000
            conn.readTimeout = readTimeoutMs
            conn.useCaches = false
            conn.instanceFollowRedirects = false // never send the token somewhere else
            conn.setRequestProperty("Accept", "application/json")
            token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            }
            cancellation?.setOnCancelListener { disconnects.execute { conn.disconnect() } }
            cancellation?.throwIfCanceled()
            val status = conn.responseCode
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Response(status, text, conn.getHeaderField("ETag"))
        } finally {
            cancellation?.setOnCancelListener(null)
            conn.disconnect()
        }
    }

    fun waitForUpdateRequest(token: String, afterMs: Long, cancellation: CancellationSignal): Long? {
        val response = call(
            "GET", "/device/update-request?after=$afterMs", token, readTimeoutMs = 65_000, cancellation = cancellation,
        )
        return when (response.status) {
            200 -> JSONObject(response.body).getLong("requestedAtMs").also {
                if (it <= afterMs) throw IOException("update request was already handled")
            }
            204 -> null
            else -> throw HttpError(response.status, response.body)
        }
    }

    override fun startPairing(mode: String, deviceInfo: Map<String, String>): Pairing {
        val r = call("POST", "/device/pairings", body = JSONObject().put("mode", mode).put("deviceInfo", JSONObject(deviceInfo)))
        if (r.status != 201) throw HttpError(r.status, r.body)
        val j = JSONObject(r.body)
        return Pairing(
            id = j.getString("pairingId"),
            code = j.getString("code"),
            pollSecret = j.getString("pollSecret"),
            qrUrl = j.getString("qrUrl"),
            expiresAtMs = java.time.Instant.parse(j.getString("expiresAt")).toEpochMilli(),
        )
    }

    override fun pollPairing(pairingId: String, pollSecret: String): PairPoll {
        val r = call("GET", "/device/pairings/$pairingId", headers = mapOf("X-Poll-Secret" to pollSecret))
        return when (r.status) {
            200 -> JSONObject(r.body).let { PairPoll.Paired(it.getString("phoneId"), it.getString("deviceToken")) }
            202 -> PairPoll.Waiting
            404, 410 -> PairPoll.Expired
            else -> throw HttpError(r.status, r.body)
        }
    }

    override fun enroll(token: String, installId: String, deviceInfo: Map<String, String>): EnrollResult {
        val body = JSONObject().put("token", token).put("installId", installId).put("deviceInfo", JSONObject(deviceInfo))
        val r = call("POST", "/device/enroll", body = body)
        return when (r.status) {
            200 -> JSONObject(r.body).let { EnrollResult.Paired(it.getString("phoneId"), it.getString("deviceToken")) }
            400, 404, 410 -> EnrollResult.Rejected
            else -> throw HttpError(r.status, r.body) // 429, 5xx: keep the token and try again later
        }
    }

    override fun fetchRules(token: String, etag: String?): RulesResult {
        val r = call("GET", "/device/rules", token, headers = etag?.let { mapOf("If-None-Match" to it) } ?: emptyMap())
        return when (r.status) {
            200 -> RulesResult.Changed(r.etag ?: "", r.body)
            304 -> RulesResult.Unchanged
            401 -> RulesResult.Unpaired
            else -> throw HttpError(r.status, r.body)
        }
    }

    override fun reportApps(token: String, apps: List<InstalledApp>) {
        val arr = JSONArray()
        apps.take(1000).forEach {
            arr.put(JSONObject().put("packageName", it.packageName).put("label", it.label.take(100)).put("core", it.core))
        }
        val r = call("PUT", "/device/apps", token, JSONObject().put("apps", arr))
        if (r.status != 204) throw HttpError(r.status, r.body)
    }

    override fun reportLocation(token: String, fix: LocationFix): Boolean {
        val body = JSONObject().put("lat", fix.lat).put("lon", fix.lon).put("recordedAt", iso(fix.recordedAtMs))
        fix.accuracyM?.let { body.put("accuracyM", it.toDouble()) }
        val r = call("PUT", "/device/location", token, body)
        return when (r.status) {
            204 -> true
            409 -> false
            else -> throw HttpError(r.status, r.body)
        }
    }

    override fun reportStatus(token: String, status: DeviceStatus) {
        val r = call("PUT", "/device/status", token, status.toJson())
        if (r.status != 204) throw HttpError(r.status, r.body)
    }

    override fun ackReleased(token: String): Boolean {
        val r = call("POST", "/device/released", token, JSONObject())
        return when (r.status) {
            204, 401 -> true
            409 -> false
            else -> throw HttpError(r.status, r.body)
        }
    }

    override fun reportSafety(token: String, requestId: String, event: String): Boolean {
        require(requestId.matches(Regex("[0-9a-fA-F-]{36}"))) { "bad request id" }
        val r = call("POST", "/device/safety/$requestId", token, JSONObject().put("event", event))
        return when (r.status) {
            204 -> true
            400, 404 -> false
            else -> throw HttpError(r.status, r.body)
        }
    }
}
