// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.net.Uri
import android.telecom.CallRedirectionService
import android.telecom.PhoneAccountHandle
import android.util.Log
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.UnreadableRules
import org.plainphone.app.contacts.contactPolicy

/**
 * Second layer for outgoing calls (#24). Telecom asks the app that holds the call redirection role
 * before every outgoing call, whichever phone app placed it. On Android 10 to 13 the default phone
 * app can be changed in Settings; with this role Plainphone still stops calls to numbers that are
 * not approved. Telecom never passes emergency calls here, and the contact rule allows emergency
 * numbers anyway.
 */
class PlainphoneCallRedirectionService : CallRedirectionService() {
    override fun onPlaceCall(handle: Uri, initialPhoneAccount: PhoneAccountHandle, allowInteractiveResponse: Boolean) {
        val number = handle.schemeSpecificPart?.takeIf { it.isNotBlank() }
        var unreadable = false
        val allowed = runCatching {
            contactPolicy().decide(ContactPolicySources.strictRules(this), Channel.CALL, Direction.OUTGOING, number).allowed
        }.getOrElse {
            // The rules cannot be read: only the parents and emergency numbers, or everything when the
            // phone has no copy of the parents' numbers (same rule as the in-call service).
            Log.e(TAG, "redirection check failed, using the parents' numbers", it)
            unreadable = true
            runCatching { UnreadableRules.outgoingCall(this, number).allowed }.getOrDefault(true)
        }
        if (allowed) {
            RecentDials.record(number)
            placeCallUnmodified()
            return
        }
        Log.i(TAG, "cancelled outgoing call to a number that is not approved")
        TelephonyLog(this).recordBlocked(Channel.CALL, Direction.OUTGOING, number)
        CallNotifications.showBlockedCall(this, number, rulesUnreadable = unreadable)
        cancelCall()
    }

    private companion object {
        const val TAG = "Plainphone"
    }
}
