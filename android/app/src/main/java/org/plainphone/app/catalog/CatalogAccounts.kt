// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.catalog

import android.accounts.Account
import android.accounts.AccountManager
import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.os.UserManager
import android.util.Log
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import org.json.JSONArray
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.Lock
import org.plainphone.app.sync.StatusNotices
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.update.InstallLease

/** Keeps account identities on the phone and tracks sign-in even after its activity goes away. */
internal object CatalogAccounts {
    const val GOOGLE = "com.google"
    const val FALLBACK_MS = 3 * 60_000L
    private const val PREFS = "plainphone_catalog_accounts"
    private const val LATE_ACCOUNT_GRACE_MS = 15 * 60_000L
    private const val RESTRICTION = UserManager.DISALLOW_MODIFY_ACCOUNTS
    private var watchedManager: AccountManager? = null

    data class Request(
        val id: String,
        val leaseId: String,
        val pkg: String,
        val baseline: Set<String>,
        val fallback: Boolean,
    )

    @Synchronized
    fun watchAccounts(context: Context) {
        val app = context.applicationContext
        val manager = AccountManager.get(app)
        if (watchedManager === manager) return
        manager.addOnAccountsUpdatedListener(
            { runCatching { accountsUpdated(app) }.onFailure { Log.w("Plainphone", "Could not reconcile catalog accounts", it) } },
            null, true, null,
        )
        watchedManager = manager
    }

    @SuppressLint("ApplySharedPref")
    @Synchronized
    fun start(
        context: Context, pkg: String, expectedLease: String? = null, fallbackId: String? = null,
    ): Request? {
        val lease = InstallLease.android(context)
        val id = checkNotNull(lease.catalogId())
        check(expectedLease == null || id == expectedLease)
        check(InstallWindow.current(context) == pkg && eligible(context))
        if (recentMarkers(context).values.any { it.getString(2) == id && !it.hasOutcome() }) return null
        val remainingMs = lease.catalogRemainingMs(id)
        check(remainingMs > 0)
        check(context.getSystemService(UserManager::class.java).hasUserRestriction(RESTRICTION))
        watchAccounts(context)
        val baseline = fingerprints(context, allTypes = fallbackId != null).keys
        val request = Request(fallbackId ?: UUID.randomUUID().toString(), id, pkg, baseline, fallbackId != null)
        val ttlMs = remainingMs + LATE_ACCOUNT_GRACE_MS
        val marker = JSONArray().put(pkg).put(JSONArray(baseline)).put(id)
            .put(System.currentTimeMillis() + ttlMs).put(SystemClock.elapsedRealtime() + ttlMs)
            .put(request.fallback)
        // The authenticator can outlive Plainphone. Record the baseline before starting it.
        check(prefs(context).edit().putString(request.id, marker.toString()).commit())
        try {
            if (request.fallback) {
                check(lease.clearCatalogAccountsIfAllowed(id, request.id, {
                    eligible(context) && InstallWindow.current(context) == pkg
                }) {
                    AndroidDeviceControls(context).clearRestriction(RESTRICTION)
                })
                check(!context.getSystemService(UserManager::class.java).hasUserRestriction(RESTRICTION))
            }
            return request
        } catch (e: Exception) {
            complete(context, request)
            throw e
        }
    }

    @Synchronized
    fun complete(context: Context, request: Request): Boolean {
        try {
            reconcile(context)
        } finally {
            if (request.fallback) InstallLease.android(context).finishCatalogAccounts(request.id)
        }
        val current = fingerprints(context, allTypes = request.fallback)
        val added = if (request.fallback) {
            recentMarkers(context)[request.id]?.optBoolean(6) == true &&
                expectedGoogleAddition(request.baseline, current)
        } else {
            current.keys.any { it !in request.baseline }
        }
        prefs(context).edit().remove(request.id).apply()
        return added
    }

    @Synchronized
    private fun accountsUpdated(context: Context) = reconcile(context)

    private fun reconcile(context: Context) {
        val markers = recentMarkers(context).filterValues { !it.hasOutcome() }
        if (markers.isEmpty()) return
        val current = fingerprints(context, allTypes = markers.values.any { it.optBoolean(5) })
        val google = current.filterValues { it == GOOGLE }
        val lease = InstallLease.android(context)
        markers.forEach { (id, marker) ->
            val baselineJson = marker.getJSONArray(1)
            val baseline = (0 until baselineJson.length()).map(baselineJson::getString).toSet()
            if (marker.optBoolean(5)) {
                if (baseline == current.keys) return@forEach
                val expected = lease.allowsCatalogAccountChanges(id) && expectedGoogleAddition(baseline, current)
                lease.finishCatalogAccounts(id)
                if (!expected) reportUnexpectedChange(context)
                // Keep the first observed outcome for the authenticator callback.
                marker.put(6, expected)
                prefs(context).edit().putString(id, marker.toString()).apply()
            } else if (google.keys.any { it !in baseline }) {
                // A matching open request must not suppress the warning for a matching closed one.
                if (!isOpen(context, marker.getString(2), marker.getString(0))) reportUnexpectedChange(context)
                prefs(context).edit().remove(id).apply()
            }
        }
    }

    private fun JSONArray.hasOutcome() = length() > 6

    private fun expectedGoogleAddition(baseline: Set<String>, current: Map<String, String>): Boolean =
        current.keys.containsAll(baseline) && (current.keys - baseline).singleOrNull()?.let(current::get) == GOOGLE

    private fun recentMarkers(context: Context): Map<String, JSONArray> {
        val p = prefs(context)
        val wallNow = System.currentTimeMillis()
        val elapsedNow = SystemClock.elapsedRealtime()
        val validRemainingMs = 1..(InstallLease.MAX_MS + LATE_ACCOUNT_GRACE_MS)
        val recent = mutableMapOf<String, JSONArray>()
        val cleanup = p.edit()
        p.all.forEach { (id, value) ->
            val marker = JSONArray(value as String)
            val wallRemainingMs = marker.optLong(3, 0L) - wallNow
            val elapsedRemainingMs = marker.optLong(4, 0L) - elapsedNow
            if (wallRemainingMs in validRemainingMs && elapsedRemainingMs in validRemainingMs) {
                recent[id] = marker
            } else {
                cleanup.remove(id)
            }
        }
        cleanup.apply()
        return recent
    }

    private fun isOpen(context: Context, id: String, pkg: String) =
        InstallLease.android(context).catalogId() == id && InstallWindow.current(context) == pkg

    private fun eligible(context: Context): Boolean {
        val sync = SyncStore(context)
        return AndroidDeviceControls(context).isDeviceOwner() && !Lock.isInMaintenanceWindow(context) &&
            !sync.released && !sync.releaseAsked
    }

    private fun reportUnexpectedChange(context: Context) {
        StatusNotices(context).record(StatusNotices.LATE_GOOGLE_ACCOUNT)
        SyncScheduler.now(context, "Unexpected catalog account change")
    }

    private fun fingerprints(context: Context, allTypes: Boolean): Map<String, String> {
        val manager = AccountManager.get(context)
        val accounts = if (allTypes) manager.accounts else manager.getAccountsByType(GOOGLE)
        return accounts.associate { account -> accountFingerprint(account) to account.type }
    }

    private fun accountFingerprint(account: Account): String =
        if (account.type == GOOGLE) fingerprint(account.name) else ":" + fingerprint(account.type + "\u0000" + account.name)

    private fun fingerprint(name: String): String =
        Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(name.toByteArray()))

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
