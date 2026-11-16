// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.content.Context
import android.content.SharedPreferences
import android.util.Log

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

    val isPaired: Boolean get() = prefs.contains(KEY_TOKEN) && !removed

    /** True after the server answered 401: the phone was removed from the dashboard. Rules keep applying. */
    val removed: Boolean get() = prefs.getBoolean(KEY_REMOVED, false)

    /** True once the phone has ever been paired. After that a new pairing needs the maintenance PIN. */
    val everPaired: Boolean get() = prefs.getBoolean(KEY_EVER_PAIRED, false)

    val phoneId: String? get() = prefs.getString(KEY_PHONE_ID, null)

    fun savePaired(phoneId: String, token: String) {
        prefs.edit()
            .putString(KEY_TOKEN, box.seal(token))
            .putString(KEY_PHONE_ID, phoneId)
            .putBoolean(KEY_EVER_PAIRED, true)
            .putBoolean(KEY_REMOVED, false)
            // A new pairing starts from a clean slate on the server side; force a full fetch and fresh reports.
            .remove(KEY_ETAG).remove(KEY_APPS_HASH).remove(KEY_STATUS_HASH).remove(KEY_STATUS_AT)
            .remove(KEY_PAIRING)
            .commit()
    }

    fun markRemoved() {
        prefs.edit().putBoolean(KEY_REMOVED, true).apply()
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

    var locationAtMs: Long
        get() = prefs.getLong(KEY_LOCATION_AT, 0L)
        set(v) { prefs.edit().putLong(KEY_LOCATION_AT, v).apply() }

    companion object {
        private const val TAG = "Plainphone"
        const val PREFS = "plainphone_sync"
        private const val KEY_TOKEN = "device_token"
        private const val KEY_PHONE_ID = "phone_id"
        private const val KEY_REMOVED = "removed"
        private const val KEY_EVER_PAIRED = "ever_paired"
        private const val KEY_PAIRING = "pairing"
        private const val KEY_ETAG = "etag"
        private const val KEY_RULES = "rules"
        private const val KEY_SYNC_AT = "sync_at"
        private const val KEY_APPS_HASH = "apps_hash"
        private const val KEY_STATUS_HASH = "status_hash"
        private const val KEY_STATUS_AT = "status_at"
        private const val KEY_LOCATE_ANSWERED = "locate_answered"
        private const val KEY_LOCATION_AT = "location_at"
    }
}
