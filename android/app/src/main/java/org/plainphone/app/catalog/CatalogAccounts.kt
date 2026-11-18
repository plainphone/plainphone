// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.catalog

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
            { runCatching { accountsUpdated(app) }.onFailure { Log.w("Plainphone", "Could not reconcile Google accounts", it) } },
            null, true, arrayOf(GOOGLE),
        )
        watchedManager = manager
    }

    @SuppressLint("ApplySharedPref")
    @Synchronized
    fun start(context: Context, pkg: String, expectedLease: String? = null): Request? {
        val lease = InstallLease.android(context)
        val id = checkNotNull(lease.catalogId())
        check(expectedLease == null || id == expectedLease)
        check(InstallWindow.current(context) == pkg && eligible(context))
        if (recentMarkers(context).values.any { it.getString(2) == id }) return null
        val remainingMs = lease.catalogRemainingMs(id)
        check(remainingMs > 0)
        check(context.getSystemService(UserManager::class.java).hasUserRestriction(RESTRICTION))
        watchAccounts(context)
        val baseline = fingerprints(context)
        val request = Request(UUID.randomUUID().toString(), id, pkg, baseline, expectedLease != null)
        val ttlMs = remainingMs + LATE_ACCOUNT_GRACE_MS
        val marker = JSONArray().put(pkg).put(JSONArray(baseline)).put(id)
            .put(System.currentTimeMillis() + ttlMs).put(SystemClock.elapsedRealtime() + ttlMs)
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
        val lease = InstallLease.android(context)
        if (request.fallback) lease.finishCatalogAccounts(request.id)
        val current = fingerprints(context)
        reconcile(context, current)
        prefs(context).edit().remove(request.id).apply()
        return current.any { it !in request.baseline }
    }

    @Synchronized
    private fun accountsUpdated(context: Context) = reconcile(context, fingerprints(context))

    private fun reconcile(context: Context, current: Set<String>) {
        val additions = recentMarkers(context).filterValues { marker ->
            val baseline = marker.getJSONArray(1)
            val seen = (0 until baseline.length()).map(baseline::getString).toSet()
            current.any { it !in seen }
        }
        if (additions.isEmpty()) return
        val lease = InstallLease.android(context)
        additions.keys.forEach(lease::finishCatalogAccounts)
        // Android does not identify the originating sign-in. A matching open request
        // must not suppress the warning for a matching closed one.
        if (additions.values.any { !isOpen(context, it.getString(2), it.getString(0)) }) reportLate(context)
        prefs(context).edit().apply { additions.keys.forEach { remove(it) } }.apply()
    }

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

    private fun reportLate(context: Context) {
        StatusNotices(context).record(StatusNotices.LATE_GOOGLE_ACCOUNT)
        SyncScheduler.now(context, "Google account added after install window")
    }

    private fun fingerprints(context: Context) =
        AccountManager.get(context).getAccountsByType(GOOGLE).mapTo(mutableSetOf()) { fingerprint(it.name) }

    private fun fingerprint(name: String): String =
        Base64.getEncoder().encodeToString(MessageDigest.getInstance("SHA-256").digest(name.toByteArray()))

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
