// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.content.Context
import android.os.UserManager
import org.plainphone.app.update.InstallLease

/**
 * A lock step deliberately lifted for a parent-approved window, until [untilMs] (wall clock).
 * The dashboard shows it calmly; the server raises an alert only once [untilMs] has passed
 * (docs/sync-api.md, `liftedPolicies`).
 */
data class LiftedPolicy(val name: String, val untilMs: Long) {
    companion object {
        /** The account restriction's step name, as [org.plainphone.app.PolicyApplier] reports it. */
        const val ACCOUNTS = "restriction ${UserManager.DISALLOW_MODIFY_ACCOUNTS}"

        /** Read live: "Allow accounts briefly" lifts and relocks the restriction outside the lock run. */
        fun read(context: Context, deviceOwner: Boolean): List<LiftedPolicy> {
            if (!deviceOwner) return emptyList()
            val until = runCatching { InstallLease.android(context).accountsLiftedUntil() }.getOrNull()
            return listOfNotNull(until?.let { LiftedPolicy(ACCOUNTS, it) })
        }
    }
}
