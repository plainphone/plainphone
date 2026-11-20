// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.catalog

import android.accounts.Account
import android.accounts.AccountManager
import android.annotation.SuppressLint
import android.content.Context
import java.security.MessageDigest
import java.security.SecureRandom
import java.util.Base64
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.Lock
import org.plainphone.app.sync.StatusNotices
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

/**
 * The Google accounts the parents approved, as salted fingerprints that never leave the phone (#75).
 *
 * The sign-in markers of [CatalogAccounts] expire 15 minutes after the install deadline, and a login
 * left open in the authenticator can finish later. This set has no expiry: any Google account that
 * appears outside it while the lock restricts accounts is reported once ([StatusNotices.LATE_GOOGLE_ACCOUNT]).
 *
 * An account joins the set when it is on the phone the first time the set is built, or appears
 * during a maintenance unlock, while an approved sign-in or "Allow accounts briefly" is open, or
 * while the lock does not restrict accounts at all (light mode, release). Accounts that leave the
 * phone leave the set. The fingerprint is SHA-256 over a random per-phone salt, the account type
 * and the name, so it cannot be matched against an address elsewhere.
 */
internal object ApprovedAccounts {
    private const val PREFS = "plainphone_approved_accounts"
    private const val SALT = "salt"
    private const val APPROVED = "approved"
    private const val REPORTED = "reported"

    /** Called on every account change. [signInOpen]: an approved sign-in expected a new account. */
    @Synchronized
    fun onAccountsChanged(context: Context, signInOpen: Boolean) {
        val p = prefs(context)
        val current = googleFingerprints(context)
        val approved = p.getStringSet(APPROVED, null)
        if (approved == null || signInOpen || !restricted(context)) {
            save(context, current, emptySet())
            return
        }
        val reported = p.getStringSet(REPORTED, null).orEmpty()
        val late = current - approved - reported
        if (late.isNotEmpty()) {
            StatusNotices(context).record(StatusNotices.LATE_GOOGLE_ACCOUNT)
            SyncScheduler.now(context, "Google account outside the approved set")
        }
        save(context, approved intersect current, (reported + late) intersect current)
    }

    /** A maintenance unlock ended: the parents may have added accounts while Plainphone was not listening. */
    @Synchronized
    fun approveCurrent(context: Context) = save(context, googleFingerprints(context), emptySet())

    private fun restricted(context: Context): Boolean {
        val sync = SyncStore(context)
        return AndroidDeviceControls(context).isDeviceOwner() && !Lock.isInMaintenanceWindow(context) &&
            !sync.released && !sync.releaseAsked
    }

    @SuppressLint("ApplySharedPref")
    private fun save(context: Context, approved: Set<String>, reported: Set<String>) {
        check(prefs(context).edit().putStringSet(APPROVED, approved).putStringSet(REPORTED, reported).commit())
    }

    private fun googleFingerprints(context: Context): Set<String> {
        val salt = salt(context)
        return AccountManager.get(context).getAccountsByType(CatalogAccounts.GOOGLE)
            .map { fingerprint(salt, it) }.toSet()
    }

    internal fun fingerprint(salt: ByteArray, account: Account): String {
        val digest = MessageDigest.getInstance("SHA-256")
        digest.update(salt)
        digest.update((account.type + "\u0000" + account.name).toByteArray())
        return Base64.getEncoder().encodeToString(digest.digest())
    }

    @SuppressLint("ApplySharedPref")
    private fun salt(context: Context): ByteArray {
        val p = prefs(context)
        p.getString(SALT, null)?.let { return Base64.getDecoder().decode(it) }
        val salt = ByteArray(32).also(SecureRandom()::nextBytes)
        check(p.edit().putString(SALT, Base64.getEncoder().encodeToString(salt)).commit())
        return salt
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
