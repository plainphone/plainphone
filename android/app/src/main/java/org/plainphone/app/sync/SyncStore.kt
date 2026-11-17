// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import org.json.JSONObject

/**
 * Everything the sync remembers between runs: the device token (sealed with the keystore),
 * the last good rules and their ETag, and what was last reported. The rules survive reboots
 * and keep applying while the server cannot be reached.
 */
class SyncStore(context: Context, private val box: SecretBox = KeystoreSecretBox()) {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    // --- Pairing -----------------------------------------------------------------

    fun deviceToken(): String? = prefs.getString(KEY_TOKEN, null)?.let { sealed ->
        box.open(sealed).also { if (it == null) Log.w(TAG, "stored device token cannot be opened") }
    }

    /** Paired and the token still opens (a lost keystore key means pairing again, behind the PIN). */
    val isPaired: Boolean get() = prefs.contains(KEY_TOKEN) && !removed && deviceToken() != null

    /** True after the server answered 401: the phone was removed from the dashboard. Rules keep applying. */
    val removed: Boolean get() = prefs.getBoolean(KEY_REMOVED, false)

    /** True once the phone has ever been paired. After that a new pairing needs the maintenance PIN. */
    val everPaired: Boolean get() = prefs.getBoolean(KEY_EVER_PAIRED, false)

    val phoneId: String? get() = prefs.getString(KEY_PHONE_ID, null)

    /**
     * True once a parent's release has switched Plainphone off on this phone. From then on the
     * lock never comes back, even if the server could not be told yet: only the acknowledgement
     * is retried. Cleared by a new pairing.
     */
    val released: Boolean get() = prefs.getBoolean(KEY_RELEASED, false)

    /**
     * The stored rules ask for a release, and they belong to this pairing. Rules kept from an
     * earlier pairing (removed, then paired again) never release the phone, and a phone removed
     * in the dashboard keeps its lock with the last rules, as removing always did.
     */
    val releaseAsked: Boolean get() = !removed && rules()?.let { it.release && it.phoneId == phoneId } == true

    // commit, not apply: a crash must not make the next sync lock a released phone again.
    @SuppressLint("ApplySharedPref")
    fun markReleased() {
        prefs.edit().putBoolean(KEY_RELEASED, true).remove(KEY_PENDING_LOCATION).commit()
    }

    /** The server said nobody asked for a release, so the phone goes on as an ordinary synced phone. */
    fun clearReleased() {
        prefs.edit().remove(KEY_RELEASED).apply()
    }

    // commit, not apply: the token is handed out exactly once, so it must be on disk before we go on.
    @SuppressLint("ApplySharedPref")
    fun savePaired(phoneId: String, token: String) {
        prefs.edit()
            .putString(KEY_TOKEN, box.seal(token))
            .putString(KEY_PHONE_ID, phoneId)
            .putBoolean(KEY_EVER_PAIRED, true)
            .putBoolean(KEY_REMOVED, false)
            .remove(KEY_RELEASED)
            // A new pairing starts from a clean slate on the server side; force a full fetch and fresh reports.
            .remove(KEY_ETAG).remove(KEY_APPS_HASH).remove(KEY_STATUS_HASH).remove(KEY_STATUS_AT)
            .remove(KEY_FIND_ATTEMPT_REQUEST).remove(KEY_FIND_ATTEMPT_AT)
            .remove(KEY_CHECKIN_ATTEMPT_ID).remove(KEY_CHECKIN_ATTEMPT_AT)
            .remove(KEY_PENDING_LOCATION)
            .remove(KEY_PAIRING)
            .remove(KEY_ENROLL)
            .commit()
    }

    /** The one-time enrollment token from the provisioning QR code, until it is used or refused. */
    fun enrollToken(): String? = prefs.getString(KEY_ENROLL, null)?.let(box::open)

    @SuppressLint("ApplySharedPref") // written during provisioning, before the process may be killed
    fun saveEnrollToken(token: String?) {
        prefs.edit().apply { if (token == null) remove(KEY_ENROLL) else putString(KEY_ENROLL, box.seal(token)) }.commit()
    }

    /** Random id made once per install; lets the server recognise this phone if an answer was lost. */
    @SuppressLint("ApplySharedPref")
    fun installId(): String = prefs.getString(KEY_INSTALL_ID, null) ?: run {
        val bytes = ByteArray(18).also { java.security.SecureRandom().nextBytes(it) }
        val id = android.util.Base64.encodeToString(bytes, android.util.Base64.URL_SAFE or android.util.Base64.NO_WRAP or android.util.Base64.NO_PADDING)
        prefs.edit().putString(KEY_INSTALL_ID, id).commit()
        id
    }

    fun markRemoved() {
        prefs.edit().putBoolean(KEY_REMOVED, true).remove(KEY_PENDING_LOCATION).apply()
    }

    fun pairing(): Pairing? = prefs.getString(KEY_PAIRING, null)?.let { raw ->
        runCatching {
            val parts = raw.split('\n')
            Pairing(parts[0], parts[1], box.open(parts[2]) ?: return null, parts[3], parts[4].toLong())
        }.getOrNull()
    }

    fun savePairing(p: Pairing?) {
        if (p == null) {
            prefs.edit().remove(KEY_PAIRING).apply()
            return
        }
        prefs.edit().putString(KEY_PAIRING, listOf(p.id, p.code, box.seal(p.pollSecret), p.qrUrl, p.expiresAtMs.toString()).joinToString("\n")).apply()
    }

    // --- Rules -------------------------------------------------------------------

    val etag: String? get() = prefs.getString(KEY_ETAG, null)

    /** The last rules that parsed. Null before the first successful fetch. */
    fun rules(): ServerRules? = prefs.getString(KEY_RULES, null)?.let { text ->
        runCatching { ServerRules.parse(text) }.onFailure { Log.e(TAG, "stored rules do not parse", it) }.getOrNull()
    }

    /** Stores the rules only after they parsed, so a broken answer never replaces good rules. */
    @SuppressLint("ApplySharedPref") // on disk before they are applied, so a crash cannot lose them
    fun saveRules(etag: String, body: String, nowMs: Long) {
        ServerRules.parse(body)
        prefs.edit().putString(KEY_RULES, body).putString(KEY_ETAG, etag).putLong(KEY_SYNC_AT, nowMs).commit()
    }

    fun markSynced(nowMs: Long) {
        prefs.edit().putLong(KEY_SYNC_AT, nowMs).apply()
    }

    /** When the server last answered a rules request (200 or 304). */
    val lastSyncAtMs: Long? get() = prefs.getLong(KEY_SYNC_AT, 0L).takeIf { it > 0 }

    // --- What was reported --------------------------------------------------------

    var appsHash: String?
        get() = prefs.getString(KEY_APPS_HASH, null)
        set(v) { prefs.edit().putString(KEY_APPS_HASH, v).apply() }

    var statusHash: String?
        get() = prefs.getString(KEY_STATUS_HASH, null)
        set(v) { prefs.edit().putString(KEY_STATUS_HASH, v).apply() }

    var statusAtMs: Long
        get() = prefs.getLong(KEY_STATUS_AT, 0L)
        set(v) { prefs.edit().putLong(KEY_STATUS_AT, v).apply() }

    /** The "Find" request (its requestedAt) the phone already answered. */
    var answeredLocateMs: Long
        get() = prefs.getLong(KEY_LOCATE_ANSWERED, 0L)
        set(v) { prefs.edit().putLong(KEY_LOCATE_ANSWERED, v).apply() }

    /** The Find (its requestedAt) the child was already told about; retries do not repeat it. */
    var shownLocateMs: Long
        get() = prefs.getLong(KEY_LOCATE_SHOWN, 0L)
        set(v) { prefs.edit().putLong(KEY_LOCATE_SHOWN, v).apply() }

    var locationAtMs: Long
        get() = prefs.getLong(KEY_LOCATION_AT, 0L)
        set(v) { prefs.edit().putLong(KEY_LOCATION_AT, v).apply() }

    /** The unanswered "Are you okay?" whose one position was already sent. */
    var locatedCheckInId: String?
        get() = prefs.getString(KEY_CHECKIN_LOCATED, null)
        set(v) { prefs.edit().putString(KEY_CHECKIN_LOCATED, v).apply() }

    fun lastFindAttempt(requestedAtMs: Long): Long? =
        if (prefs.getLong(KEY_FIND_ATTEMPT_REQUEST, Long.MIN_VALUE) == requestedAtMs) {
            prefs.getLong(KEY_FIND_ATTEMPT_AT, Long.MIN_VALUE)
        } else null

    fun lastCheckInAttempt(id: String): Long? =
        if (prefs.getString(KEY_CHECKIN_ATTEMPT_ID, null) == id) {
            prefs.getLong(KEY_CHECKIN_ATTEMPT_AT, Long.MIN_VALUE)
        } else null

    internal fun pendingLocation(): PendingLocation? =
        prefs.getString(KEY_PENDING_LOCATION, null)?.let(box::open)?.let { raw ->
            runCatching {
                val json = JSONObject(raw)
                PendingLocation(
                    fix = LocationFix(
                        json.getDouble("lat"),
                        json.getDouble("lon"),
                        if (json.has("accuracyM")) json.getDouble("accuracyM").toFloat() else null,
                        json.getLong("recordedAtMs"),
                    ),
                    findRequestedAtMs = if (json.has("find")) json.getLong("find") else null,
                    checkInId = if (json.has("checkIn")) json.getString("checkIn") else null,
                    attemptedAtMs = json.getLong("attemptedAtMs"),
                )
            }.getOrNull()
        }

    @SuppressLint("ApplySharedPref") // The fix must survive a process death during upload.
    internal fun savePendingLocation(pending: PendingLocation): Boolean {
        val json = JSONObject()
            .put("lat", pending.fix.lat)
            .put("lon", pending.fix.lon)
            .put("accuracyM", pending.fix.accuracyM?.toDouble())
            .put("recordedAtMs", pending.fix.recordedAtMs)
            .put("find", pending.findRequestedAtMs)
            .put("checkIn", pending.checkInId)
            .put("attemptedAtMs", pending.attemptedAtMs)
        return prefs.edit().putString(KEY_PENDING_LOCATION, box.seal(json.toString())).commit()
    }

    fun clearPendingLocation() {
        if (prefs.contains(KEY_PENDING_LOCATION)) prefs.edit().remove(KEY_PENDING_LOCATION).apply()
    }

    @SuppressLint("ApplySharedPref") // Advance the retry schedule together with clearing the uploaded fix.
    fun recordLocationAttempts(requestedAtMs: Long?, checkInId: String?, nowMs: Long): Boolean =
        prefs.edit().apply {
            if (requestedAtMs != null) {
                putLong(KEY_FIND_ATTEMPT_REQUEST, requestedAtMs).putLong(KEY_FIND_ATTEMPT_AT, nowMs)
            }
            if (checkInId != null) {
                putString(KEY_CHECKIN_ATTEMPT_ID, checkInId).putLong(KEY_CHECKIN_ATTEMPT_AT, nowMs)
            }
            remove(KEY_PENDING_LOCATION)
        }.commit()

    companion object {
        private const val TAG = "Plainphone"
        const val PREFS = "plainphone_sync"
        private const val KEY_TOKEN = "device_token"
        private const val KEY_PHONE_ID = "phone_id"
        private const val KEY_REMOVED = "removed"
        private const val KEY_RELEASED = "released"
        private const val KEY_EVER_PAIRED = "ever_paired"
        private const val KEY_PAIRING = "pairing"
        private const val KEY_ENROLL = "enroll_token"
        private const val KEY_INSTALL_ID = "install_id"
        private const val KEY_ETAG = "etag"
        private const val KEY_RULES = "rules"
        private const val KEY_SYNC_AT = "sync_at"
        private const val KEY_APPS_HASH = "apps_hash"
        private const val KEY_STATUS_HASH = "status_hash"
        private const val KEY_STATUS_AT = "status_at"
        private const val KEY_LOCATE_ANSWERED = "locate_answered"
        private const val KEY_LOCATE_SHOWN = "locate_shown"
        private const val KEY_LOCATION_AT = "location_at"
        private const val KEY_CHECKIN_LOCATED = "checkin_located"
        private const val KEY_PENDING_LOCATION = "pending_location"
        private const val KEY_FIND_ATTEMPT_REQUEST = "find_attempt_request"
        private const val KEY_FIND_ATTEMPT_AT = "find_attempt_at"
        private const val KEY_CHECKIN_ATTEMPT_ID = "checkin_attempt_id"
        private const val KEY_CHECKIN_ATTEMPT_AT = "checkin_attempt_at"
    }
}

internal data class PendingLocation(
    val fix: LocationFix,
    val findRequestedAtMs: Long?,
    val checkInId: String?,
    val attemptedAtMs: Long,
)
