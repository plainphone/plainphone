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
class SyncStore(context: Context, private val box: SecretBox = DEVICE_BOX) {
    private val app = context.applicationContext
    private val prefs: SharedPreferences = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    internal val statusNotices = StatusNotices(app)

    internal fun installWindowOverrun(nowMs: Long) =
        org.plainphone.app.update.InstallLease.latestOverrun(app, nowMs)?.takeIf {
            it.sequence > prefs.getLong(KEY_ACKED_INSTALL_OVERRUN, 0) &&
                nowMs - it.recordedAtMs in 0 until INSTALL_OVERRUN_TTL_MS
        }

    @SuppressLint("ApplySharedPref")
    internal fun acknowledgeInstallOverrun(sequence: Long) {
        prefs.edit().putLong(KEY_ACKED_INSTALL_OVERRUN, sequence).commit()
    }

    // --- Pairing -----------------------------------------------------------------

    fun deviceToken(): String? {
        val sealed = prefs.getString(KEY_TOKEN, null) ?: return null
        // Injected boxes are independent of the real device keystore.
        if (box !== DEVICE_BOX) return openToken(sealed)
        if (removed) return null
        tokenCache?.takeIf { it.prefs === prefs && it.sealed == sealed }?.let { return it.token }
        return synchronized(tokenLock) {
            val current = prefs.getString(KEY_TOKEN, null) ?: return@synchronized null
            if (removed) return@synchronized null
            tokenCache?.takeIf { it.prefs === prefs && it.sealed == current }?.token
                ?: openToken(current)?.also { tokenCache = CachedToken(prefs, current, it) }
        }
    }

    private fun openToken(sealed: String): String? =
        box.open(sealed).also { if (it == null) Log.w(TAG, "stored device token cannot be opened") }

    /** Cheap scheduling hint. The worker still needs a usable token before it can sync. */
    internal val hasStoredPairing: Boolean get() = prefs.contains(KEY_TOKEN) && !removed

    /** A lost keystore key still permits re-pairing behind the PIN. */
    val isPaired: Boolean get() = hasStoredPairing && deviceToken() != null

    /** True after the server answered 401: the phone was removed from the dashboard. Rules keep applying. */
    val removed: Boolean get() = prefs.getBoolean(KEY_REMOVED, false)

    /** True once the phone has ever been paired. After that a new pairing needs the maintenance PIN. */
    val everPaired: Boolean get() = prefs.getBoolean(KEY_EVER_PAIRED, false)

    internal var contactSuggestionsReadAt: Long?
        get() = prefs.getLong("contact_suggestions_read_${phoneId}", -1L).takeIf { it >= 0 }
        set(value) {
            val key = "contact_suggestions_read_${phoneId}"
            prefs.edit().apply {
                if (value == null) remove(key) else putLong(key, value)
            }.apply()
        }

    val phoneId: String? get() = prefs.getString(KEY_PHONE_ID, null)

    internal fun favouriteSetupPhoneId(): String? {
        val id = phoneId ?: return null
        if (!hasStoredPairing || released || setupUndoPending || prefs.getString(KEY_FAVOURITE_SETUP, null) != id) return null
        return id.takeIf { rules()?.let { it.phoneId == id && it.profile == "self" && !it.release } == true }
    }

    internal fun completeFavouriteSetup(expectedPhoneId: String) = synchronized(tokenLock) {
        if (prefs.getString(KEY_FAVOURITE_SETUP, null) == expectedPhoneId) {
            prefs.edit().remove(KEY_FAVOURITE_SETUP).apply()
        }
    }

    internal val setupUndoPending: Boolean get() = !removed && prefs.getBoolean(KEY_SETUP_UNDO_PENDING, false)

    @SuppressLint("ApplySharedPref") // A tap accepted offline must survive process death.
    internal fun markSetupUndoPending(expectedPhoneId: String): Boolean = synchronized(tokenLock) {
        if (phoneId != expectedPhoneId || !isPaired || released || setupUndoPending) return@synchronized false
        prefs.edit().putBoolean(KEY_SETUP_UNDO_PENDING, true).commit()
    }

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
        prefs.edit().putBoolean(KEY_RELEASED, true).remove(KEY_PENDING_LOCATION).remove(KEY_PENDING_CHECKIN_LOCATION).commit()
    }

    /** The server said nobody asked for a release, so the phone goes on as an ordinary synced phone. */
    fun clearReleased() {
        prefs.edit().remove(KEY_RELEASED).apply()
    }

    // commit, not apply: the token is handed out exactly once, so it must be on disk before we go on.
    @SuppressLint("ApplySharedPref")
    fun savePaired(phoneId: String, token: String, account: PlainphoneApi.PollAccount? = null) {
        synchronized(tokenLock) {
            val pairing = prefs.edit()
                .putString(KEY_TOKEN, box.seal(token))
                .putString(KEY_PHONE_ID, phoneId)
                .putString(KEY_CONNECTED_EMAIL, account?.maskedEmail)
                .putString(KEY_CONNECTED_HOUSEHOLD, account?.householdName)
                .putBoolean(KEY_EVER_PAIRED, true)
                .putBoolean(KEY_REMOVED, false)
                .remove(KEY_RELEASED).remove(KEY_SETUP_UNDO_PENDING)
                // A new pairing starts from a clean slate on the server side; force a full fetch and fresh reports.
                .remove(KEY_ETAG).remove(KEY_APPS_HASH).remove(KEY_STATUS_HASH).remove(KEY_STATUS_AT)
                .remove(KEY_FIND_ATTEMPT_REQUEST).remove(KEY_FIND_ATTEMPT_AT)
                .remove(KEY_CHECKIN_ATTEMPT_ID).remove(KEY_CHECKIN_ATTEMPT_AT)
                .remove(KEY_PENDING_LOCATION).remove(KEY_PENDING_CHECKIN_LOCATION)
                .remove(KEY_PAIRING)
                .remove(KEY_ENROLL).remove("enroll_confirmed")
            if (!everPaired) pairing.putString(KEY_FAVOURITE_SETUP, phoneId)
            else if (this.phoneId != phoneId) pairing.remove(KEY_FAVOURITE_SETUP)
            synchronized(appReportLock) {
                pairing.putLong(KEY_APPS_GENERATION, nextAppGeneration()).commit()
            }
            tokenCache = null
        }
    }

    internal fun enrollmentAccount(): PlainphoneApi.PollAccount? {
        val email = prefs.getString(KEY_CONNECTED_EMAIL, null) ?: return null
        if (!hasStoredPairing || released || releaseAsked) return null
        return PlainphoneApi.PollAccount(email, prefs.getString(KEY_CONNECTED_HOUSEHOLD, null))
    }

    internal fun dismissEnrollmentAccount() {
        prefs.edit().remove(KEY_CONNECTED_EMAIL).remove(KEY_CONNECTED_HOUSEHOLD).apply()
    }

    internal fun watchEnrollmentAccount(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        prefs.registerOnSharedPreferenceChangeListener(listener)

    internal fun unwatchEnrollmentAccount(listener: SharedPreferences.OnSharedPreferenceChangeListener) =
        prefs.unregisterOnSharedPreferenceChangeListener(listener)

    /** The one-time enrollment token from the provisioning QR code, until it is used or refused. */
    fun enrollToken(): String? = prefs.getString(KEY_ENROLL, null)?.let(box::open)

    val enrollmentConfirmed: Boolean get() = prefs.getBoolean("enroll_confirmed", false)

    @SuppressLint("ApplySharedPref") // Worker may redeem the token after process death.
    fun confirmEnrollment(): Boolean = prefs.edit().putBoolean("enroll_confirmed", true).commit()

    @SuppressLint("ApplySharedPref") // written during provisioning, before the process may be killed
    fun saveEnrollToken(token: String?) {
        if (token != null && token == enrollToken()) return
        prefs.edit().remove("enroll_confirmed").apply {
            if (token == null) remove(KEY_ENROLL) else putString(KEY_ENROLL, box.seal(token))
        }.commit()
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
        synchronized(tokenLock) {
            prefs.edit().putBoolean(KEY_REMOVED, true).remove(KEY_PENDING_LOCATION).remove(KEY_PENDING_CHECKIN_LOCATION).apply()
            tokenCache = null
        }
        rulesCache = null
    }

    fun pairing(): Pairing? = prefs.getString(KEY_PAIRING, null)?.let { raw ->
        runCatching {
            val parts = raw.split('\n')
            Pairing(parts[0], parts[1], box.open(parts[2]) ?: return null, parts[3], parts[4].toLong(), parts.getOrNull(5) == "true")
        }.getOrNull()
    }

    fun savePairing(p: Pairing?) {
        if (p == null) {
            prefs.edit().remove(KEY_PAIRING).apply()
            return
        }
        prefs.edit().putString(KEY_PAIRING, listOf(p.id, p.code, box.seal(p.pollSecret), p.qrUrl, p.expiresAtMs.toString(), p.requiresConfirmation.toString()).joinToString("\n")).apply()
    }

    // --- Rules -------------------------------------------------------------------

    val etag: String? get() = prefs.getString(KEY_ETAG, null)

    /** The last rules that parsed. Null before the first successful fetch. */
    fun rules(): ServerRules? = prefs.getString(KEY_RULES, null)?.let { text ->
        rulesCache?.takeIf { it.first == text }?.second
            ?: runCatching { ServerRules.parse(text) }
                .onFailure { Log.e(TAG, "stored rules do not parse", it) }
                .getOrNull()
                ?.also { rulesCache = text to it }
    }

    /** Stores the rules only after they parsed, so a broken answer never replaces good rules. */
    @SuppressLint("ApplySharedPref") // on disk before they are applied, so a crash cannot lose them
    fun saveRules(etag: String, body: String, nowMs: Long) {
        val parsed = ServerRules.parse(body)
        prefs.edit().putString(KEY_RULES, body).putString(KEY_ETAG, etag).putLong(KEY_SYNC_AT, nowMs).commit()
        rulesCache = body to parsed
        markAppsDirty()
    }

    fun markSynced(nowMs: Long) {
        prefs.edit().putLong(KEY_SYNC_AT, nowMs).apply()
    }

    /** When the server last answered a rules request (200 or 304). */
    val lastSyncAtMs: Long? get() = prefs.getLong(KEY_SYNC_AT, 0L).takeIf { it > 0 }

    // --- What was reported --------------------------------------------------------

    val appsHash: String? get() = prefs.getString(KEY_APPS_HASH, null)

    // Use a generation so a package broadcast during a scan or upload still triggers another scan.
    internal fun markAppsDirty() {
        synchronized(appReportLock) {
            prefs.edit().putLong(KEY_APPS_GENERATION, nextAppGeneration()).apply()
        }
    }

    private fun nextAppGeneration() = prefs.getLong(KEY_APPS_GENERATION, 0L) + 1

    internal fun appScanGeneration(nowMs: Long, dynamicCore: Set<String>): Long? = synchronized(appReportLock) {
        val generation = prefs.getLong(KEY_APPS_GENERATION, 0L)
        val lastScan = prefs.getLong(KEY_APPS_SCANNED_AT, 0L)
        generation.takeIf {
            appsHash == null || dynamicCore != prefs.getStringSet(KEY_APPS_DYNAMIC_CORE, null) ||
                lastScan == 0L || nowMs - lastScan !in 0 until APP_SCAN_INTERVAL_MS ||
                generation != prefs.getLong(KEY_APPS_SCANNED_GENERATION, -1L)
        }
    }

    internal fun finishAppScan(generation: Long, hash: String, nowMs: Long, dynamicCore: Set<String>) {
        synchronized(appReportLock) {
            if (prefs.getLong(KEY_APPS_GENERATION, 0L) != generation) {
                // The server may now hold a different hash from the one we last recorded.
                prefs.edit().remove(KEY_APPS_HASH).apply()
                return
            }
            prefs.edit().putString(KEY_APPS_HASH, hash).putLong(KEY_APPS_SCANNED_AT, nowMs)
                .putLong(KEY_APPS_SCANNED_GENERATION, generation)
                .putStringSet(KEY_APPS_DYNAMIC_CORE, dynamicCore).apply()
        }
    }

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

    private fun pendingLocationKey(checkIn: Boolean) =
        if (checkIn) KEY_PENDING_CHECKIN_LOCATION else KEY_PENDING_LOCATION

    internal fun pendingLocation(checkIn: Boolean = false): PendingLocation? =
        prefs.getString(pendingLocationKey(checkIn), null)?.let(box::open)?.let { raw ->
            runCatching {
                val json = JSONObject(raw)
                val purpose = when {
                    json.has("purpose") -> json.getString("purpose")
                    json.has("find") && !json.has("checkIn") -> "find:${json.getLong("find")}"
                    else -> return@let null
                }
                // Only the dedicated slot guarantees that a saved check-in came from a fresh lookup.
                if (!purpose.startsWith(if (checkIn) "checkin:" else "find:")) return@let null
                PendingLocation(
                    fix = LocationFix(
                        json.getDouble("lat"),
                        json.getDouble("lon"),
                        if (json.has("accuracyM")) json.getDouble("accuracyM").toFloat() else null,
                        json.getLong("recordedAtMs"),
                    ),
                    purpose = purpose,
                    attemptedAtMs = json.getLong("attemptedAtMs"),
                    conflict = json.optBoolean("conflict"),
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
            .put("purpose", pending.purpose)
            .put("attemptedAtMs", pending.attemptedAtMs)
            .put("conflict", pending.conflict)
        return prefs.edit().putString(pendingLocationKey(pending.purpose.startsWith("checkin:")), box.seal(json.toString())).commit()
    }

    fun clearPendingLocation(checkIn: Boolean) {
        val key = pendingLocationKey(checkIn)
        if (prefs.contains(key)) prefs.edit().remove(key).apply()
    }

    internal fun isLocationRejected(fix: LocationFix): Boolean =
        fix.recordedAtMs.toString() in prefs.getStringSet(KEY_REJECTED_LOCATION_TIMES, emptySet()).orEmpty()

    @SuppressLint("ApplySharedPref") // Advance the retry schedule together with clearing the uploaded fix.
    fun recordLocationAttempts(
        requestedAtMs: Long?,
        checkInId: String?,
        nowMs: Long,
        rejectedAtMs: Long? = null,
    ): Boolean =
        prefs.edit().apply {
            if (rejectedAtMs != null) {
                val rejected = prefs.getStringSet(KEY_REJECTED_LOCATION_TIMES, emptySet()).orEmpty()
                putStringSet(KEY_REJECTED_LOCATION_TIMES, rejected + rejectedAtMs.toString())
                if (requestedAtMs == null && checkInId == null) putLong(KEY_LOCATION_AT, nowMs)
            }
            if (requestedAtMs != null) {
                putLong(KEY_FIND_ATTEMPT_REQUEST, requestedAtMs).putLong(KEY_FIND_ATTEMPT_AT, nowMs)
            }
            if (checkInId != null) {
                putString(KEY_CHECKIN_ATTEMPT_ID, checkInId).putLong(KEY_CHECKIN_ATTEMPT_AT, nowMs)
            }
            if (requestedAtMs != null) remove(KEY_PENDING_LOCATION)
            if (checkInId != null) remove(KEY_PENDING_CHECKIN_LOCATION)
        }.commit()

    private data class CachedToken(val prefs: SharedPreferences, val sealed: String, val token: String)

    companion object {
        private val DEVICE_BOX = KeystoreSecretBox()
        private val tokenLock = Any()
        private val appReportLock = Any()
        @Volatile private var tokenCache: CachedToken? = null
        @Volatile private var rulesCache: Pair<String, ServerRules>? = null
        private const val APP_SCAN_INTERVAL_MS = 24 * 60 * 60_000L
        private const val TAG = "Plainphone"
        private const val KEY_ACKED_INSTALL_OVERRUN = "acked_install_overrun"
        private const val INSTALL_OVERRUN_TTL_MS = 7 * 24 * 60 * 60_000L
        const val PREFS = "plainphone_sync"
        private const val KEY_TOKEN = "device_token"
        private const val KEY_PHONE_ID = "phone_id"
        private const val KEY_REMOVED = "removed"
        private const val KEY_SETUP_UNDO_PENDING = "local_setup_undo_pending"
        private const val KEY_RELEASED = "released"
        private const val KEY_EVER_PAIRED = "ever_paired"
        private const val KEY_PAIRING = "pairing"
        private const val KEY_CONNECTED_EMAIL = "connected_email"
        private const val KEY_CONNECTED_HOUSEHOLD = "connected_household"
        private const val KEY_ENROLL = "enroll_token"
        private const val KEY_INSTALL_ID = "install_id"
        private const val KEY_ETAG = "etag"
        private const val KEY_RULES = "rules"
        private const val KEY_FAVOURITE_SETUP = "favourite_setup_phone_id"
        private const val KEY_SYNC_AT = "sync_at"
        private const val KEY_APPS_HASH = "apps_hash"
        private const val KEY_APPS_GENERATION = "apps_generation"
        private const val KEY_APPS_SCANNED_AT = "apps_scanned_at"
        private const val KEY_APPS_DYNAMIC_CORE = "apps_dynamic_core"
        private const val KEY_APPS_SCANNED_GENERATION = "apps_scanned_generation"
        private const val KEY_STATUS_HASH = "status_hash"
        private const val KEY_STATUS_AT = "status_at"
        private const val KEY_LOCATE_ANSWERED = "locate_answered"
        private const val KEY_LOCATE_SHOWN = "locate_shown"
        private const val KEY_LOCATION_AT = "location_at"
        private const val KEY_CHECKIN_LOCATED = "checkin_located"
        private const val KEY_REJECTED_LOCATION_TIMES = "rejected_location_times"
        private const val KEY_PENDING_LOCATION = "pending_location"
        private const val KEY_PENDING_CHECKIN_LOCATION = "pending_checkin_location"
        private const val KEY_FIND_ATTEMPT_REQUEST = "find_attempt_request"
        private const val KEY_FIND_ATTEMPT_AT = "find_attempt_at"
        private const val KEY_CHECKIN_ATTEMPT_ID = "checkin_attempt_id"
        private const val KEY_CHECKIN_ATTEMPT_AT = "checkin_attempt_at"
    }
}

internal data class PendingLocation(
    val fix: LocationFix,
    val purpose: String,
    val attemptedAtMs: Long,
    val conflict: Boolean = false,
)
