// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.CancellationSignal
import java.io.IOException
import java.io.InterruptedIOException
import java.net.BindException
import java.net.ConnectException
import java.net.HttpURLConnection
import java.net.NoRouteToHostException
import java.net.URL
import java.net.UnknownHostException
import java.util.concurrent.Executors
import javax.net.ssl.SSLHandshakeException
import javax.net.ssl.SSLPeerUnverifiedException
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.DeviceContact
import org.plainphone.app.requests.PhoneRequest

/** The phone's side of the sync API (server/openapi.yaml, tag "device"). Faked in unit tests. */
interface SyncApi {
    fun startPairing(mode: String, deviceInfo: Map<String, String>): Pairing
    fun startConfirmedPairing(mode: String, deviceInfo: Map<String, String>, profile: String?): Pairing =
        startPairing(mode, deviceInfo)
    fun decidePairing(pairing: Pairing, confirm: Boolean): PairPoll = error("Pairing confirmation unavailable")
    fun pollPairing(pairingId: String, pollSecret: String): PairPoll
    /** Pairs with the one-time token from a dashboard-made provisioning QR code (POST /device/enroll). */
    fun enroll(token: String, installId: String, deviceInfo: Map<String, String>): EnrollResult
    fun fetchRules(token: String, etag: String?): RulesResult
    fun reportContactSuggestions(token: String, contacts: List<DeviceContact>) {}
    fun reportApps(token: String, apps: List<InstalledApp>)
    /** False when location is off for this phone (the server answers 409). */
    fun reportLocation(token: String, fix: LocationFix, purpose: String): Boolean
    fun registerWakeup(token: String, fcm: String?, endpoint: String?): Boolean = false
    fun reportStatus(token: String, status: DeviceStatus)
    /**
     * Tells the server Plainphone is switched off after a release (POST /device/released). True when
     * the server deleted the phone (204) or no longer knows it (401); false when nobody asked for a
     * release (409). Other answers and network errors throw.
     */
    fun ackReleased(token: String): Boolean
    fun reportSetupCompletion(token: String, completion: SetupCompletion): Unit = throw IOException("setup completion reporting unavailable")
    fun reportSetupUndo(token: String): Boolean = throw IOException("setup undo reporting unavailable")
    /**
     * Tells the server what happened to a ring or an "Are you okay?" (`shown`, `here`, `ok`, `call`).
     * False when the server no longer knows the request (404) or refuses the event (400): drop it.
     */
    fun reportSafety(token: String, requestId: String, event: String): Boolean
    /** The phone's own requests: open ones and answers from the last 30 days (`GET /device/requests`). */
    fun phoneRequests(token: String): List<PhoneRequest> = emptyList()
    /**
     * Tells the server that a parent approved [requestId] on the phone with the PIN
     * (`POST /device/requests/{id}/approve-on-phone`). The request as it stands now, or null when there
     * is nothing to report any more (the server does not know it, or this is not a child phone).
     * Idempotent: the first answer wins and a repeat changes nothing. Throws on network errors, so the
     * phone tries again.
     */
    fun reportApprovedOnPhone(token: String, requestId: String): PhoneRequest? = null
    /**
     * Asks the parents for more time on an app or the daily cap ([TimeLimits.TOTAL]). Returns the new
     * request (201) or today's open one for the same target (200). Other answers throw [HttpError]:
     * 403 switched off, 409 not possible (no limit, not a child phone), 429 too many, 400 bad input.
     */
    fun askMoreTime(token: String, packageName: String, reason: String?): MoreTimeRequest =
        throw IOException("asking for more time unavailable")
    /** This phone's asks from the last 24 hours, newest first. */
    fun moreTimeRequests(token: String): List<MoreTimeRequest> = throw IOException("asking for more time unavailable")
    /**
     * Tells the server about an emergency opening the phone already granted itself
     * (`POST /device/emergency-openings`, light mode, Self profile). The server never rejects it:
     * 204 always, idempotent on the opening's id. True on 204; false on 400 (malformed: drop it, a
     * retry changes nothing). Anything else throws, so the opening stays queued for the next sync.
     */
    fun reportEmergencyOpening(token: String, opening: org.plainphone.app.light.EmergencyOpening): Boolean =
        throw IOException("emergency opening reports unavailable")
}

data class Pairing(
    val id: String,
    val code: String,
    val pollSecret: String,
    val qrUrl: String,
    val expiresAtMs: Long,
    val requiresConfirmation: Boolean = true,
)

sealed interface PairPoll {
    data class Confirm(val maskedEmail: String, val householdName: String?) : PairPoll
    data object Waiting : PairPoll
    data object InvalidKey : PairPoll
    data object Expired : PairPoll
    data class Paired(
        val phoneId: String,
        val deviceToken: String,
        val account: PlainphoneApi.PollAccount? = null,
        val setupUndoMinutes: Int? = null,
    ) : PairPoll
}

sealed interface EnrollResult {
    data class Paired(
        val phoneId: String,
        val deviceToken: String,
        val account: PlainphoneApi.PollAccount? = null,
        val setupUndoMinutes: Int? = null,
    ) : EnrollResult
    /** The server refused the token for good (unknown, used, expired): pair with a code instead. */
    data object InvalidKey : EnrollResult
    data object OutdatedQr : EnrollResult
    data object Rejected : EnrollResult
}

sealed interface RulesResult {
    data object Unchanged : RulesResult
    /** 401: the phone was removed in the dashboard (or never paired). */
    data object Unpaired : RulesResult
    data class Changed(val etag: String, val body: String) : RulesResult
}

/**
 * The server's answer to a quick message: how many parent devices got a push (with 0 the phone sends
 * an SMS), whether it was over the limit (recorded but quiet: no SMS either), or whether the first
 * send with this id is still notifying (ask again).
 */
data class QuickSendAnswer(val notified: Int, val limited: Boolean = false, val pending: Boolean = false)

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
    val resetProtection: String? = null,
    val accountTypes: List<String>? = null,
    val appVersionCode: Long? = null,
    val update: org.plainphone.app.update.UpdateReport? = null,
    val mode: String = "strong",
    val protections: Map<String, Boolean>? = null,
    val timeUsed: Map<String, Int>? = null,
    val installOverrunSequence: Long? = null,
    val callRoleActionNeeded: Boolean = false,
    val parallelAppsRemovedId: String? = null,
    val lateGoogleAccountId: String? = null,
    val rulesReceiptConfirmed: Boolean? = null,
    val webFilterActive: Boolean? = null,
    val androidVersion: String? = null,
    val pushProvider: String? = null,
    val filter: org.plainphone.app.light.FilterHealth? = null,
    val appUpdates: org.plainphone.app.update.AppUpdateLog.Report? = null,
    val liftedPolicies: List<LiftedPolicy> = emptyList(),
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
        .put("resetProtection", resetProtection?.take(40) ?: JSONObject.NULL)
        .put("accountTypes", accountTypes?.let { t -> JSONArray(t.take(20).map { it.take(100) }) } ?: JSONObject.NULL)
        .put("mode", mode)
        .apply {
            // Optional fields (docs/sync-api.md): only sent when known.
            rulesReceiptConfirmed?.let { put("rulesReceiptConfirmed", it) }
            webFilterActive?.let { put("webFilterActive", it) }
            filter?.let {
                put("filterMethod", it.method.wire)
                put("filterWorking", it.working)
                it.issue?.let { issue -> put("filterIssue", issue) }
            }
            protections?.let { put("protections", JSONObject(it)) }
            timeUsed?.let { used -> put("timeUsed", JSONObject(used.entries.take(200).associate { it.key to it.value.coerceIn(0, 1440) })) }
            if (callRoleActionNeeded) put("callRoleActionNeeded", true)
            parallelAppsRemovedId?.let {
                put("parallelAppsRemoved", true)
                put("parallelAppsRemovedId", it)
            }
            lateGoogleAccountId?.let { put("lateGoogleAccountId", it) }
            if (liftedPolicies.isNotEmpty()) put("liftedPolicies", JSONArray(liftedPolicies.take(10).map {
                JSONObject().put("name", it.name.take(200)).put("until", iso(it.untilMs))
            }))
            installOverrunSequence?.let { put("installOverrunSequence", it) }
            pushProvider?.let { put("pushProvider", it) }
            appVersionCode?.let { put("appVersionCode", it) }
            androidVersion?.let { put("androidVersion", it) }
            update?.let { put("update", it.toJson()) }
            appUpdates?.let { r ->
                put("appUpdates", JSONObject()
                    .put("id", r.id.take(64))
                    .put("trigger", r.trigger.wire)
                    .put("openedAt", r.openedAtMs?.let(::iso) ?: JSONObject.NULL)
                    .put("closedAt", r.closedAtMs?.let(::iso) ?: JSONObject.NULL)
                    .put("updated", r.updated.coerceIn(0, 1000))
                    .put("caught", JSONArray(r.caught.take(20)))
                    .apply { r.error?.let { put("error", it) } })
            }
        }
}

internal fun iso(ms: Long): String = java.time.Instant.ofEpochMilli(ms).toString()

/** Failures identifiable as connection setup, TLS verification or a deadline: the request was not (fully) sent. */
internal fun neverReachedServer(e: IOException): Boolean =
    e is InterruptedIOException || e is UnknownHostException || e is ConnectException ||
        e is NoRouteToHostException || e is BindException || e is SSLHandshakeException ||
        e is SSLPeerUnverifiedException

/** HTTP error that is not a network failure: the server answered, but not as expected. */
class HttpError(val status: Int, message: String) : IOException("HTTP $status: ${message.take(200)}")

/**
 * Plain [HttpURLConnection] client, no dependencies. Blocking: call it from a worker thread.
 * Network failures surface as [IOException]; nothing here ever changes the lock.
 */
class PlainphoneApi private constructor(
    baseUrl: String,
    private val openConnection: (URL) -> HttpURLConnection,
    private val openFreshConnection: (URL) -> HttpURLConnection,
    private val setupKey: () -> JSONObject? = { null },
    private val initialFilterMethod: () -> String? = { null },
) : SyncApi, MoveApi {
    internal constructor(baseUrl: String) : this(baseUrl, { it.openConnection() as HttpURLConnection })

    internal constructor(baseUrl: String, openConnection: (URL) -> HttpURLConnection) :
        this(baseUrl, openConnection, openConnection)

    constructor(baseUrl: String, context: Context) : this(
        baseUrl,
        { it.openConnection() as HttpURLConnection },
        { url ->
            val manager = context.getSystemService(ConnectivityManager::class.java)
            val network = manager?.boundNetworkForProcess ?: manager?.activeNetwork
                ?: throw IOException("no active network")
            // Connection: close alone can still select another idle socket from Android's shared pool.
            // A new Network instance has its own, initially empty connection pool.
            Network.fromNetworkHandle(network.networkHandle).openConnection(url) as HttpURLConnection
        },
        { org.plainphone.app.light.LightSetup.selfKey(context) },
        { org.plainphone.app.light.LightSetup.initialFilterMethod(context) },
    )

    private companion object {
        // Disconnect can block on I/O. Keep it off the screen broadcast thread.
        val disconnects = Executors.newSingleThreadExecutor()
    }

    private val base = baseUrl.trimEnd('/') + "/api"

    /** [replayed]: the first attempt failed with a network error and this is the answer to the second. */
    private class Response(val status: Int, val body: String, val etag: String?, val replayed: Boolean = false)

    private fun call(
        method: String,
        path: String,
        token: String? = null,
        body: JSONObject? = null,
        headers: Map<String, String> = emptyMap(),
        readTimeoutMs: Int = 30_000,
        cancellation: CancellationSignal? = null,
        replayable: Boolean = method == "GET",
    ): Response {
        val url = URL(base + path)
        val payload = body?.toString()?.toByteArray(Charsets.UTF_8)
        val closeOnFirstAttempt = !replayable && (method == "GET" || method == "POST")
        cancellation?.throwIfCanceled()
        val conn = if (closeOnFirstAttempt) openFreshConnection(url) else openConnection(url)
        val streamBody = method == "POST" || (method == "PUT" && replayable)
        return try {
            exchange(conn, method, token, payload, headers, readTimeoutMs, cancellation, closeOnFirstAttempt, streamBody)
        } catch (e: IOException) {
            // HttpURLConnection does not expose socket reuse. Exclude failures that are
            // identifiable as connection setup, TLS verification, or a read/write deadline.
            if (!replayable || cancellation?.isCanceled == true || neverReachedServer(e)) throw e
            exchange(openFreshConnection(url), method, token, payload, headers, readTimeoutMs, cancellation, true, streamBody).let {
                Response(it.status, it.body, it.etag, replayed = true)
            }
        }
    }

    private fun exchange(
        conn: HttpURLConnection,
        method: String,
        token: String?,
        body: ByteArray?,
        headers: Map<String, String>,
        readTimeoutMs: Int,
        cancellation: CancellationSignal?,
        close: Boolean,
        streamBody: Boolean,
    ): Response {
        try {
            cancellation?.throwIfCanceled()
            conn.requestMethod = method
            conn.connectTimeout = minOf(15_000, readTimeoutMs)
            conn.readTimeout = readTimeoutMs
            conn.useCaches = false
            conn.instanceFollowRedirects = false // never send the token somewhere else
            conn.setRequestProperty("Accept", "application/json")
            token?.let { conn.setRequestProperty("Authorization", "Bearer $it") }
            headers.forEach { (k, v) -> conn.setRequestProperty(k, v) }
            if (close) conn.setRequestProperty("Connection", "close")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                // Keep replays of these request bodies under the caller's control.
                if (streamBody) conn.setFixedLengthStreamingMode(body.size)
                conn.outputStream.use { it.write(body) }
            }
            cancellation?.setOnCancelListener { disconnects.execute { conn.disconnect() } }
            cancellation?.throwIfCanceled()
            val status = conn.responseCode
            if (status < 0) throw IOException("invalid HTTP response")
            val stream = if (status >= 400) conn.errorStream else conn.inputStream
            val text = stream?.bufferedReader(Charsets.UTF_8)?.use { it.readText() } ?: ""
            return Response(status, text, conn.getHeaderField("ETag"))
        } catch (e: Exception) {
            if (!close && cancellation == null) conn.disconnect()
            throw e
        } finally {
            // Preserve the cancellable long poll's connection lifecycle.
            cancellation?.setOnCancelListener(null)
            if (close || cancellation != null) conn.disconnect()
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

    override fun startPairing(mode: String, deviceInfo: Map<String, String>): Pairing =
        startConfirmedPairing(mode, deviceInfo, null)

    override fun startConfirmedPairing(mode: String, deviceInfo: Map<String, String>, profile: String?): Pairing {
        val body = JSONObject().put("mode", mode).put("deviceInfo", JSONObject(deviceInfo)).put("profile", profile)
        if (mode == "light") body.put("confirmOnPhone", true)
        val r = call("POST", "/device/pairings", body = body)
        if (r.status != 201) throw HttpError(r.status, r.body)
        val j = JSONObject(r.body)
        val requiresConfirmation = j.optBoolean("confirmOnPhone")
        if (mode == "light" && !requiresConfirmation) throw IOException("Server does not support pairing confirmation")
        return Pairing(
            id = j.getString("pairingId"),
            code = j.getString("code"),
            pollSecret = j.getString("pollSecret"),
            qrUrl = j.getString("qrUrl"),
            expiresAtMs = java.time.Instant.parse(j.getString("expiresAt")).toEpochMilli(),
            requiresConfirmation = requiresConfirmation,
        )
    }

    override fun pollPairing(pairingId: String, pollSecret: String): PairPoll {
        val r = call(
            "GET", "/device/pairings/$pairingId", headers = mapOf("X-Poll-Secret" to pollSecret), replayable = false,
        )
        return pairingResult(r)
    }

    override fun decidePairing(pairing: Pairing, confirm: Boolean): PairPoll {
        val r = call("POST", "/device/pairings/${pairing.id}",
            headers = mapOf("X-Poll-Secret" to pairing.pollSecret),
            body = JSONObject().put("action", if (confirm) "confirm" else "cancel")
                .put("key", if (confirm) setupKey() else null)
                .put("filterMethod", if (confirm) initialFilterMethod() else null))
        if (confirm && invalidSetupKey(r)) return PairPoll.InvalidKey
        return pairingResult(r)
    }

    private fun invalidSetupKey(r: Response): Boolean {
        if (r.status != 400) return false
        val json = runCatching { JSONObject(r.body) }.getOrNull() ?: return false
        if (json.optString("error") == "invalid setup key") return true
        val issues = json.optJSONArray("issues") ?: return false
        return (0 until issues.length()).any { issues.optJSONObject(it)?.optString("path")?.substringBefore('.') == "key" }
    }

    private fun pairingResult(r: Response): PairPoll =
        when (r.status) {
            200 -> JSONObject(r.body).let {
                PairPoll.Paired(it.getString("phoneId"), it.getString("deviceToken"), readPairingAccount(it), readSetupUndoMinutes(it))
            }
            202 -> JSONObject(r.body).let {
                if (it.optString("status") == "confirm") {
                    PairPoll.Confirm(it.getString("maskedEmail"), it.optString("householdName").takeUnless { _ -> it.isNull("householdName") })
                } else PairPoll.Waiting
            }
            204, 404, 410 -> PairPoll.Expired
            else -> throw HttpError(r.status, r.body)
        }

    fun reviewEnrollment(token: String, mode: String): Pair<PollAccount, String> {
        val r = call("POST", "/device/enrollment-review", body = JSONObject().put("token", token).put("mode", mode))
        if (r.status != 200) throw HttpError(r.status, r.body)
        val info = JSONObject(r.body)
        val household = if (info.isNull("householdName")) null else info.getString("householdName")
        return PollAccount(info.getString("maskedEmail"), household) to info.getString("profile")
    }

    fun cancelEnrollment(token: String, mode: String) {
        val r = call("POST", "/device/enrollment-review", body = JSONObject().put("token", token).put("mode", mode).put("cancel", true))
        if (r.status !in setOf(204, 404, 410)) throw HttpError(r.status, r.body)
    }

    data class PollAccount(val maskedEmail: String, val householdName: String?)

    fun selfTemplateUrl(token: String): String {
        val r = call("POST", "/device/self-template", token, JSONObject())
        if (r.status != 201) throw HttpError(r.status, r.body)
        return JSONObject(r.body).getString("url")
    }

    fun trustedInviteUrl(token: String): String? {
        val r = call("POST", "/device/trusted-invite", token, JSONObject())
        if (r.status == 409) return null
        if (r.status != 201) throw HttpError(r.status, r.body)
        return JSONObject(r.body).getString("url")
    }

    data class ApprovalRequest(val id: String, val summary: String)
    data class ApprovalQr(val url: String, val summary: String)

    fun approvalRequests(token: String, language: String): List<ApprovalRequest> {
        val r = call("GET", "/device/approval-challenge", token)
        if (r.status != 200) throw HttpError(r.status, r.body)
        return readApprovalResponse {
            val requests = JSONObject(r.body).getJSONArray("changes")
            List(requests.length()) { index ->
                val request = requests.getJSONObject(index)
                ApprovalRequest(request.getString("id"), approvalSummary(request, language))
            }
        }
    }

    fun approvalQr(token: String, changeId: String, language: String): ApprovalQr {
        val r = call("POST", "/device/approval-challenge", token, JSONObject().put("changeId", changeId))
        if (r.status != 200) throw HttpError(r.status, r.body)
        return readApprovalResponse {
            val response = JSONObject(r.body)
            ApprovalQr(response.getString("url"), approvalSummary(response, language))
        }
    }

    /**
     * What became of the request behind a QR code: waiting, approved, declined, cancelled or failed.
     * Null from a server that does not know the question yet, so the phone keeps showing the code.
     */
    fun approvalState(token: String, changeId: String): String? {
        val r = call("GET", "/device/approval-challenge/$changeId", token)
        if (r.status == 404) return null
        if (r.status != 200) throw HttpError(r.status, r.body)
        return readApprovalResponse { JSONObject(r.body).getString("state") }
    }

    private fun approvalSummary(response: JSONObject, language: String): String =
        response.getJSONObject("summary").getString(if (language == "da") "da" else "en")

    private fun <T> readApprovalResponse(read: () -> T): T = try {
        read()
    } catch (error: JSONException) {
        throw IOException("Invalid approval response", error)
    }

    override fun reportSetupCompletion(token: String, completion: SetupCompletion) {
        val body = JSONObject().put("elapsedMs", completion.elapsedMs ?: JSONObject.NULL).put("undoMinutes", completion.undoMinutes)
        val r = call("POST", "/device/setup-completion", token, body, replayable = true)
        // A server from before setup completion can still receive the legacy undo report.
        if (r.status !in listOf(200, 401, 404)) throw HttpError(r.status, r.body)
    }

    override fun reportSetupUndo(token: String): Boolean {
        // No request body is needed. Fixed-length streaming can hide a 401 response body.
        val r = call("POST", "/device/undo-setup", token, replayable = true)
        // Older servers return 404 for the missing route even when the phone is still paired.
        return when {
            r.status == 204 -> true
            isUnknownDevice(r.status, r.body) -> true
            r.status == 409 -> false
            else -> throw HttpError(r.status, r.body)
        }
    }

    override fun enroll(token: String, installId: String, deviceInfo: Map<String, String>): EnrollResult {
        val body = JSONObject().put("token", token).put("installId", installId).put("deviceInfo", JSONObject(deviceInfo))
            .put("key", setupKey())
            .put("filterMethod", initialFilterMethod())
        val r = call("POST", "/device/enroll", body = body)
        return when (r.status) {
            200 -> JSONObject(r.body).let {
                EnrollResult.Paired(it.getString("phoneId"), it.getString("deviceToken"), readPairingAccount(it), readSetupUndoMinutes(it))
            }
            400 -> if (invalidSetupKey(r)) EnrollResult.InvalidKey else EnrollResult.Rejected
            409 -> EnrollResult.OutdatedQr
            410 -> if (runCatching { JSONObject(r.body).optString("code") }.getOrNull() == "outdated_qr") {
                EnrollResult.OutdatedQr
            } else EnrollResult.Rejected
            404 -> EnrollResult.Rejected
            else -> throw HttpError(r.status, r.body) // 429, 5xx: keep the token and try again later
        }
    }

    private fun readSetupUndoMinutes(body: JSONObject): Int? =
        body.optInt("setupUndoMinutes", -1).takeIf { it in org.plainphone.app.light.SETUP_UNDO_CHOICES }

    private fun readPairingAccount(body: JSONObject): PollAccount? {
        val account = body.optJSONObject("account") ?: return null
        val email = account.optString("maskedEmail")
        val household = if (account.isNull("householdName")) null else account.optString("householdName")
        return email.takeIf(String::isNotBlank)?.let { PollAccount(it, household) }
    }

    override fun redeemMove(token: String, deviceToken: String) {
        val body = JSONObject().put("token", token).put("deviceToken", deviceToken)
        val response = call("POST", "/device/move", body = body, readTimeoutMs = 8_000)
        // A response might have been lost after redemption. Only the same credential
        // can fetch move rules in that case; no token can create a second pairing.
        if (response.status != 204 && response.status != 410) throw HttpError(response.status, response.body)
    }

    override fun moveRules(deviceToken: String): RulesResult.Changed {
        val response = call("GET", "/device/move-rules", deviceToken, readTimeoutMs = 8_000)
        if (response.status != 200) throw HttpError(response.status, response.body)
        return RulesResult.Changed(response.etag ?: throw IOException("missing move rules ETag"), response.body)
    }

    override fun fetchRules(token: String, etag: String?): RulesResult {
        val r = call("GET", "/device/rules", token, headers = etag?.let { mapOf("If-None-Match" to it) } ?: emptyMap())
        return when (r.status) {
            200 -> RulesResult.Changed(r.etag ?: "", r.body)
            304 -> RulesResult.Unchanged
            // Only the server's own answer unpairs: a 401 from a proxy in front of a self-hosted
            // server would otherwise stop every phone from syncing for good.
            else -> if (isUnknownDevice(r.status, r.body)) RulesResult.Unpaired else throw HttpError(r.status, r.body)
        }
    }

    /** The server no longer knows this phone's token: it was removed in the dashboard. */
    private fun isUnknownDevice(status: Int, body: String): Boolean =
        status == 401 && runCatching { JSONObject(body).optString("error") }.getOrNull() == "unknown device; pair again"

    fun setFavourite(token: String, contact: ApprovedContact, favourite: Boolean): Boolean {
        val request = JSONObject().put("name", contact.name).put("number", contact.number).put("favourite", favourite)
        val result = call("POST", "/device/self/favourites", token, request)
        if (result.status !in setOf(202, 204)) throw IOException("favourite change returned HTTP ${result.status}")
        return result.status == 204
    }

    override fun reportContactSuggestions(token: String, contacts: List<DeviceContact>) {
        val entries = JSONArray()
        contacts.forEach { entries.put(JSONObject().put("name", it.name).put("numbers", JSONArray(it.numbers))) }
        val result = call("PUT", "/device/contact-suggestions", token, JSONObject().put("contacts", entries))
        if (result.status != 204) throw HttpError(result.status, result.body)
    }

    override fun reportApps(token: String, apps: List<InstalledApp>) {
        val arr = JSONArray()
        apps.take(1000).forEach {
            arr.put(JSONObject().put("packageName", it.packageName).put("label", it.label.take(100)).put("core", it.core))
        }
        val r = call("PUT", "/device/apps", token, JSONObject().put("apps", arr))
        if (r.status != 204) throw HttpError(r.status, r.body)
    }

    override fun reportLocation(token: String, fix: LocationFix, purpose: String): Boolean {
        val body = JSONObject().put("lat", fix.lat).put("lon", fix.lon).put("recordedAt", iso(fix.recordedAtMs))
        body.put("purpose", purpose)
        fix.accuracyM?.let { body.put("accuracyM", it.toDouble()) }
        val requested = purpose.startsWith("find:") || purpose.startsWith("checkin:")
        val r = call("PUT", "/device/location", token, body, replayable = requested)
        return when (r.status) {
            204 -> true
            // A replay that meets 409 means the first attempt stored the fix and only its answer was lost.
            409 -> requested && r.replayed
            else -> throw HttpError(r.status, r.body)
        }
    }

    override fun registerWakeup(token: String, fcm: String?, endpoint: String?): Boolean {
        val body = JSONObject().put("fcmToken", fcm ?: JSONObject.NULL)
            .put("unifiedPushEndpoint", endpoint ?: JSONObject.NULL)
        val response = call("PUT", "/device/push-token", token, body)
        return when (response.status) {
            204 -> true
            422 -> false
            else -> throw HttpError(response.status, response.body)
        }
    }

    override fun reportStatus(token: String, status: DeviceStatus) {
        val r = call("PUT", "/device/status", token, status.toJson())
        if (r.status != 204) throw HttpError(r.status, r.body)
    }

    override fun ackReleased(token: String): Boolean {
        val r = call("POST", "/device/released", token, JSONObject(), replayable = true)
        return when (r.status) {
            204, 401 -> true
            409 -> false
            else -> throw HttpError(r.status, r.body)
        }
    }

    /** [elapsedMs]: monotonic time since the press, for the server's delivery timing; a header, so older servers ignore it. */
    fun reportSos(token: String, payload: JSONObject, elapsedMs: Long? = null): JSONObject {
        val headers = elapsedMs?.let { mapOf("X-Plainphone-Elapsed-Ms" to it.toString()) } ?: emptyMap()
        val response = call("POST", "/device/sos", token, payload, headers = headers, readTimeoutMs = 4_000, replayable = false)
        if (response.status != 200) throw HttpError(response.status, response.body)
        return try {
            JSONObject(response.body)
        } catch (err: org.json.JSONException) {
            throw IOException("Invalid SOS response", err)
        }
    }

    /**
     * An ordinary quick message (docs/sos.md). Safe to repeat: the server answers a repeated [id]
     * with the first answer.
     */
    fun sendQuickMessage(token: String, id: String, text: String, inbox: InboxSend? = null): QuickSendAnswer {
        val body = JSONObject().put("id", id).put("text", text)
        // From the family inbox (docs/family-inbox.md): it joins the thread with its original time.
        inbox?.let {
            body.put("inbox", true).put("kind", it.kind).put("sentAt", java.time.Instant.ofEpochMilli(it.sentAtMs).toString())
            if (it.smsSent) body.put("smsSent", true)
        }
        val r = call("POST", "/device/quick-messages/send", token, body, readTimeoutMs = 8_000, replayable = true)
        if (r.status != 200) throw HttpError(r.status, r.body)
        return try {
            val json = JSONObject(r.body)
            QuickSendAnswer(json.getInt("notified"), json.optBoolean("limited"), json.optBoolean("pending"))
        } catch (err: JSONException) {
            throw IOException("Invalid quick message response", err)
        }
    }

    /** The child suggests a new quick message. 201 on success; [HttpError] 409 when three are waiting, 403 when off. */
    fun suggestQuickMessage(token: String, text: String) {
        // Not replayed: a repeat would add the suggestion twice.
        val r = call("POST", "/device/quick-messages/suggest", token, JSONObject().put("text", text), readTimeoutMs = 10_000)
        if (r.status != 201) throw HttpError(r.status, r.body)
    }

    /** The family inbox thread (docs/family-inbox.md). */
    fun fetchInbox(token: String): InboxThread {
        val r = call("GET", "/device/inbox", token, readTimeoutMs = 10_000)
        if (r.status != 200) throw HttpError(r.status, r.body)
        return try {
            InboxThread.parse(JSONObject(r.body))
        } catch (err: JSONException) {
            throw IOException("Invalid inbox response", err)
        }
    }

    /** The device receipt for parent replies this phone has. Safe to repeat. */
    fun inboxReceived(token: String, ids: List<String>) {
        if (ids.isEmpty()) return
        val body = JSONObject().put("ids", org.json.JSONArray(ids))
        val r = call("POST", "/device/inbox/received", token, body, readTimeoutMs = 8_000, replayable = true)
        if (r.status != 204) throw HttpError(r.status, r.body)
    }

    fun sosStatus(token: String, id: String): JSONObject {
        val response = call("GET", "/device/sos/$id", token, readTimeoutMs = 8_000)
        if (response.status != 200) throw HttpError(response.status, response.body)
        return JSONObject(response.body)
    }

    override fun phoneRequests(token: String): List<PhoneRequest> {
        val r = call("GET", "/device/requests", token, readTimeoutMs = 15_000)
        if (r.status != 200) throw HttpError(r.status, r.body)
        val list = try {
            PhoneRequest.parseList(r.body)
        } catch (e: JSONException) {
            throw IOException("Invalid requests response", e)
        } catch (e: IllegalArgumentException) {
            throw IOException("Invalid requests response", e)
        }
        // Asks for more time are in their own list on the server; they are requests too.
        val moreTime = try {
            moreTimeRequests(token).mapNotNull(PhoneRequest::fromMoreTime)
        } catch (_: IOException) {
            emptyList()
        }
        return moreTime + list
    }

    override fun reportApprovedOnPhone(token: String, requestId: String): PhoneRequest? {
        require(requestId.matches(Regex("[0-9a-fA-F-]{36}"))) { "bad request id" }
        val r = call("POST", "/device/requests/$requestId/approve-on-phone", token, JSONObject(), replayable = true)
        return when (r.status) {
            200 -> try {
                val body = JSONObject(r.body)
                // A request for more time has no "kind".
                if (body.has("kind")) PhoneRequest.parse(body) else PhoneRequest.fromMoreTime(MoreTimeRequest.parse(body))
            } catch (e: JSONException) {
                throw IOException("Invalid approval response", e)
            } catch (e: RuntimeException) {
                throw IOException("Invalid approval response", e)
            }
            // Gone, a Self phone (no parent PIN) or a change that could not be applied: the
            // server did not take the approval, and asking again will not change that.
            404, 409 -> null
            // Any other answer that a retry cannot change (a revoked token, a bad id): drop it.
            // Only a busy or unreachable server is worth another try.
            else -> if (r.status in 400..499 && r.status != 408 && r.status != 429) null else throw HttpError(r.status, r.body)
        }
    }

    override fun reportSafety(token: String, requestId: String, event: String): Boolean {
        require(requestId.matches(Regex("[0-9a-fA-F-]{36}"))) { "bad request id" }
        val r = call(
            "POST", "/device/safety/$requestId", token, JSONObject().put("event", event), replayable = true,
        )
        return when (r.status) {
            204 -> true
            400, 404 -> false
            else -> throw HttpError(r.status, r.body)
        }
    }

    override fun askMoreTime(token: String, packageName: String, reason: String?): MoreTimeRequest {
        val body = JSONObject().put("packageName", packageName)
        reason?.trim()?.take(MORE_TIME_REASON_MAX)?.takeIf(String::isNotEmpty)?.let { body.put("reason", it) }
        // Safe to repeat: the server returns the open request for the same target.
        val r = call("POST", "/device/more-time-requests", token, body, replayable = true)
        if (r.status != 200 && r.status != 201) throw HttpError(r.status, r.body)
        return readMoreTime { MoreTimeRequest.parse(JSONObject(r.body)) }
    }

    override fun reportEmergencyOpening(token: String, opening: org.plainphone.app.light.EmergencyOpening): Boolean {
        val body = JSONObject()
            .put("id", opening.id)
            .put("packageName", opening.packageName)
            .put("openedAt", java.time.Instant.ofEpochMilli(opening.openedAtMs).toString())
            .put("minutes", opening.minutes)
        // Safe to repeat: the server counts an id once.
        val r = call("POST", "/device/emergency-openings", token, body, replayable = true)
        return when {
            r.status in 200..299 -> true
            r.status == 400 -> false
            else -> throw HttpError(r.status, r.body)
        }
    }

    override fun moreTimeRequests(token: String): List<MoreTimeRequest> {
        val r = call("GET", "/device/more-time-requests", token)
        if (r.status != 200) throw HttpError(r.status, r.body)
        return readMoreTime { MoreTimeRequest.parseList(r.body) }
    }

    private fun <T> readMoreTime(read: () -> T): T = try {
        read()
    } catch (error: JSONException) {
        throw IOException("Invalid more-time response", error)
    } catch (error: RuntimeException) {
        throw IOException("Invalid more-time response", error)
    }
}

/** The server's limit for the child's optional reason. */
const val MORE_TIME_REASON_MAX = 140
