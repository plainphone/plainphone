// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.catalog

import android.accounts.AccountManager
import android.annotation.SuppressLint
import android.content.Context
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
    fun start(context: Context, pkg: String, expectedLease: String? = null): Request {
        val lease = InstallLease.android(context)
        val id = checkNotNull(lease.catalogId())
        check(expectedLease == null || id == expectedLease)
        check(InstallWindow.current(context) == pkg && eligible(context))
        check(prefs(context).all.values.none { JSONArray(it as String).getString(2) == id }) { "Google sign-in is already running in this window" }
        check(context.getSystemService(UserManager::class.java).hasUserRestriction(RESTRICTION))
        watchAccounts(context)
        val baseline = fingerprints(context)
        val request = Request(UUID.randomUUID().toString(), id, pkg, baseline, expectedLease != null)
        val marker = JSONArray().put(pkg).put(JSONArray(baseline)).put(id)
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
        val newAccount = fingerprints(context).any { it !in request.baseline }
        if (prefs(context).contains(request.id)) {
            if (newAccount && !isOpen(context, request.leaseId, request.pkg)) reportLate(context)
            prefs(context).edit().remove(request.id).apply()
        }
        return newAccount
    }

    @Synchronized
    private fun accountsUpdated(context: Context) {
        val current = fingerprints(context)
        if (current.isEmpty()) return
        val p = prefs(context)
        val additions = p.all.mapNotNull { (id, value) ->
            val marker = JSONArray(value as String)
            val baseline = marker.getJSONArray(1)
            val seen = (0 until baseline.length()).map(baseline::getString).toSet()
            if (current.any { it !in seen }) id to isOpen(context, marker.getString(2), marker.getString(0)) else null
        }
        if (additions.isEmpty()) return
        val lease = InstallLease.android(context)
        additions.forEach { (id, _) -> lease.finishCatalogAccounts(id) }
        // Account broadcasts cannot identify an authenticator session. Prefer the current
        // request if multiple sessions could have produced the account.
        if (additions.none { it.second }) reportLate(context)
        p.edit().apply { additions.forEach { (id, _) -> remove(id) } }.apply()
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
