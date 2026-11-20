// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.catalog

import android.accounts.Account
import android.accounts.AccountManager
import android.accounts.AccountManagerFuture
import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.os.UserManager
import android.provider.Settings
import android.util.Log
import java.security.MessageDigest
import java.util.Base64
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
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
        val markers = recentMarkers(context)
        if (markers.values.any { it.getString(2) == id && !it.hasOutcome() }) return null
        val remainingMs = lease.catalogRemainingMs(id)
        check(remainingMs > 0)
        check(context.getSystemService(UserManager::class.java).hasUserRestriction(RESTRICTION))
        watchAccounts(context)
        val current = fingerprints(context, allTypes = fallbackId != null)
        val baseline = current.keys
        val request = Request(fallbackId ?: UUID.randomUUID().toString(), id, pkg, baseline, fallbackId != null)
        val ttlMs = remainingMs + LATE_ACCOUNT_GRACE_MS
        val marker = JSONArray().put(pkg).put(JSONArray(baseline)).put(id)
            .put(System.currentTimeMillis() + ttlMs).put(SystemClock.elapsedRealtime() + ttlMs)
            .put(request.fallback).put(JSONObject.NULL).put(JSONObject.NULL).put(bootId(context))
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
                // The dashboard shows the restriction as lifted until the fallback's deadline.
                SyncScheduler.now(context, "Accounts allowed briefly")
            }
            // A new approved request must not end the tracking of an expired fallback: its login can still
            // finish. Check for additions already present in case the account listener has not run yet,
            // then move the fallback's relock snapshot to the current accounts and keep it until its TTL.
            val settledFallbacks = markers.filterValues { it.optBoolean(5) && it.hasOutcome() }
            if (settledFallbacks.isNotEmpty()) {
                // Lateness is judged on the accounts read before the restriction was lifted: an account that
                // appears while this fallback is open is its own login, which the listener folds silently.
                // The fold snapshot is read now, so the account added in that gap is not lost from it.
                val seen = if (request.fallback) current else fingerprints(context, allTypes = true)
                val all = fingerprints(context, allTypes = true)
                if (settledFallbacks.values.any { hasLateAddition(it, seen) }) reportUnexpectedChange(context)
                check(foldRelocked(context, settledFallbacks, all.keys))
            }
            return request
        } catch (e: Exception) {
            complete(context, request)
            throw e
        }
    }

    @Synchronized
    fun complete(context: Context, request: Request): Boolean {
        if (request.fallback) {
            InstallLease.android(context).finishCatalogAccounts(request.id)
            val outcome = recentMarkers(context)[request.id]?.takeIf { it.hasOutcome() } ?: return false
            val current = fingerprints(context, allTypes = true)
            val lateAddition = hasLateAddition(outcome, current)
            if (lateAddition) reportUnexpectedChange(context)
            prefs(context).edit().remove(request.id).apply()
            return !lateAddition && outcome.optBoolean(6) && expectedGoogleAddition(request.baseline, current)
        }
        reconcile(context)
        val added = fingerprints(context, allTypes = false).keys.any { it !in request.baseline }
        if (added) {
            // The parent approved this sign-in: it is not a late account of an expired fallback.
            val settled = recentMarkers(context).filterValues { it.optBoolean(5) && it.hasOutcome() }
            foldRelocked(context, settled, fingerprints(context, allTypes = true).keys)
        }
        prefs(context).edit().remove(request.id).apply()
        return added
    }

    private val pendingSignIns = mutableMapOf<String, Pair<Request, AccountManagerFuture<*>>>()

    /** Remembers the authenticator request, so that it is cancelled when its window closes. */
    fun trackSignIn(context: Context, request: Request, future: AccountManagerFuture<*>) {
        synchronized(pendingSignIns) { pendingSignIns[request.id] = request to future }
        cancelClosedSignIns(context)
    }

    fun signInFinished(request: Request) {
        synchronized(pendingSignIns) { pendingSignIns.remove(request.id) }
    }

    /**
     * Cancels the account request of a closed window. The authenticator's own screen can stay open;
     * an account it adds later is outside the approved set and is reported ([ApprovedAccounts]).
     * Called outside the lease lock.
     */
    fun cancelClosedSignIns(context: Context) {
        val lease = InstallLease.android(context)
        val closed = synchronized(pendingSignIns) {
            pendingSignIns.values.filter { (request, _) ->
                if (request.fallback) !lease.allowsCatalogAccountChanges(request.id)
                else lease.catalogId() != request.leaseId
            }.onEach { pendingSignIns.remove(it.first.id) }
        }
        closed.forEach { it.second.cancel(true) }
    }

    // Called under the lease lock after relock. Taking the listener lock here would invert lock order.
    @SuppressLint("ApplySharedPref")
    fun recordFallbackOutcome(context: Context, id: String, allowSuccess: Boolean) {
        val p = prefs(context)
        val marker = p.getString(id, null)?.let(::JSONArray) ?: return
        if (!marker.optBoolean(5) || marker.hasOutcome()) return

        val baseline = baseline(marker)
        val current = fingerprints(context, allTypes = true)
        val expected = allowSuccess && expectedGoogleAddition(baseline, current)
        if (baseline != current.keys && !expected) reportUnexpectedChange(context)
        marker.put(6, expected)
        marker.put(7, JSONArray(current.keys))
        check(p.edit().putString(id, marker.toString()).commit())
    }

    @Synchronized
    private fun accountsUpdated(context: Context) {
        // Decide before reconciling, which ends a fallback as soon as its account arrives.
        val markers = trackedMarkers(context)
        val signInOpen = approvedOpen(context, markers) || legacyExpected(context, markers)
        try {
            reconcile(context)
        } finally {
            ApprovedAccounts.onAccountsChanged(context, signInOpen)
        }
    }

    private fun trackedMarkers(context: Context) =
        recentMarkers(context).filterValues { !it.hasOutcome() || it.optBoolean(5) }

    // An open approved sign-in or an open fallback (no outcome yet) expects its own new account.
    private fun approvedOpen(context: Context, markers: Map<String, JSONArray>) = markers.any { (_, m) ->
        if (m.optBoolean(5)) !m.hasOutcome() else isOpen(context, m.getString(2), m.getString(0))
    }

    // A successful outcome written before the relock set existed accepts its one Google account (hasLateAddition).
    private fun legacyExpected(context: Context, markers: Map<String, JSONArray>): Boolean {
        val legacy = markers.values.filter { it.optBoolean(5) && it.hasOutcome() && it.optBoolean(6) && it.isNull(7) }
        if (legacy.isEmpty()) return false
        val current = fingerprints(context, allTypes = true)
        return legacy.any { expectedGoogleAddition(baseline(it), current) }
    }

    private fun reconcile(context: Context) {
        val markers = trackedMarkers(context)
        if (markers.isEmpty()) return
        val current = fingerprints(context, allTypes = markers.values.any { it.optBoolean(5) })
        if (Lock.isInMaintenanceWindow(context)) {
            // The parents may add accounts while the phone is unlocked: not a late account.
            absorb(context, markers, current)
            return
        }
        val google = current.filterValues { it == GOOGLE }
        val lease = InstallLease.android(context)
        val approvedOpen = approvedOpen(context, markers)
        markers.forEach { (id, marker) ->
            val baseline = baseline(marker)
            if (marker.optBoolean(5)) {
                if (!marker.hasOutcome()) {
                    if (baseline != current.keys) lease.finishCatalogAccounts(id)
                } else if (approvedOpen) {
                    // An approved sign-in is open: its account is expected, not a late one.
                    foldRelocked(context, mapOf(id to marker), current.keys)
                } else if (hasLateAddition(marker, current)) {
                    reportUnexpectedChange(context)
                    prefs(context).edit().remove(id).apply()
                }
            } else if (google.keys.any { it !in baseline }) {
                // A matching open request must not suppress the warning for a matching closed one.
                if (!isOpen(context, marker.getString(2), marker.getString(0))) reportUnexpectedChange(context)
                prefs(context).edit().remove(id).apply()
            }
        }
    }

    /** The maintenance unlock ended: accounts the parents added meanwhile are not late ones. */
    @Synchronized
    fun maintenanceEnded(context: Context) {
        ApprovedAccounts.approveCurrent(context)
        val markers = trackedMarkers(context)
        if (markers.isEmpty()) return
        absorb(context, markers, fingerprints(context, allTypes = true))
    }

    @SuppressLint("ApplySharedPref")
    private fun absorb(context: Context, markers: Map<String, JSONArray>, current: Map<String, String>) {
        val edit = prefs(context).edit()
        markers.forEach { (id, marker) ->
            when {
                // Keep tracking an open sign-in: only accounts added after the unlock count as late.
                !marker.optBoolean(5) && !marker.hasOutcome() -> edit.putString(
                    id, marker.put(1, JSONArray(current.filterValues { it == GOOGLE }.keys)).toString(),
                )
                marker.optBoolean(5) && marker.hasOutcome() ->
                    edit.putString(id, marker.put(7, JSONArray(current.keys)).toString())
            }
        }
        edit.commit()
    }

    @SuppressLint("ApplySharedPref")
    private fun foldRelocked(context: Context, markers: Map<String, JSONArray>, current: Set<String>): Boolean {
        val edit = prefs(context).edit()
        markers.forEach { (id, marker) -> edit.putString(id, marker.put(7, JSONArray(current)).toString()) }
        return edit.commit()
    }

    private fun baseline(marker: JSONArray): Set<String> {
        return marker.getJSONArray(1).accountKeys()
    }

    private fun JSONArray.accountKeys() = (0 until length()).map(::getString).toSet()

    // The fallback lifted the restriction for every account type, so any new account is late.
    private fun hasLateAddition(marker: JSONArray, current: Map<String, String>): Boolean {
        val relocked = marker.optJSONArray(7)?.accountKeys()
        if (relocked == null) {
            // An outcome written before the relock set existed (the app upgraded inside an open window).
            // Read it strictly: any account beyond the baseline is late, except the single Google account
            // a successful outcome expected. Reading it as "nothing late" would let a late account through.
            val baseline = baseline(marker)
            return current.keys.any { it !in baseline } &&
                !(marker.optBoolean(6) && expectedGoogleAddition(baseline, current))
        }
        return current.keys.any { it !in relocked }
    }

    // Markers are padded with null up to the boot id, so a null outcome slot means "no outcome yet".
    private fun JSONArray.hasOutcome() = length() > 6 && !isNull(6)

    private fun expectedGoogleAddition(baseline: Set<String>, current: Map<String, String>): Boolean =
        current.keys.containsAll(baseline) && (current.keys - baseline).singleOrNull()?.let(current::get) == GOOGLE

    private fun recentMarkers(context: Context): Map<String, JSONArray> {
        val p = prefs(context)
        val wallNow = System.currentTimeMillis()
        val elapsedNow = SystemClock.elapsedRealtime()
        val boot = bootId(context)
        val validRemainingMs = 1..(InstallLease.MAX_MS + LATE_ACCOUNT_GRACE_MS)
        val recent = mutableMapOf<String, JSONArray>()
        val cleanup = p.edit()
        p.all.forEach { (id, value) ->
            val marker = JSONArray(value as String)
            val wallRemainingMs = marker.optLong(3, 0L) - wallNow
            val elapsedRemainingMs = marker.optLong(4, 0L) - elapsedNow
            val markerBoot = marker.optInt(8, -1)
            // Within one boot the monotonic clock decides, so a wall-clock correction cannot drop a marker.
            // After a reboot only the wall clock is comparable. Without a boot id both must agree.
            val live = when {
                boot >= 0 && markerBoot == boot -> elapsedRemainingMs in validRemainingMs
                boot >= 0 && markerBoot >= 0 -> wallRemainingMs in validRemainingMs
                else -> wallRemainingMs in validRemainingMs && elapsedRemainingMs in validRemainingMs
            }
            if (live) {
                recent[id] = marker
            } else {
                cleanup.remove(id)
            }
        }
        cleanup.apply()
        return recent
    }

    private fun bootId(context: Context): Int =
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

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
