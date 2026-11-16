// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.telecom.Call
import android.telecom.CallScreeningService
import android.telecom.TelecomManager
import android.util.Log
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.contactPolicy

/**
 * Screens incoming calls before the phone rings. Telecom binds this for the
 * default phone app. Calls from numbers that are not approved, and from hidden
 * numbers, are rejected silently: no ring, no notification, no call log entry.
 * They are only written to Plainphone's local blocked log.
 */
class PlainphoneCallScreeningService : CallScreeningService() {
    override fun onScreenCall(details: Call.Details) {
        if (details.callDirection != Call.Details.DIRECTION_INCOMING) {
            respondToCall(details, CallResponse.Builder().build())
            return
        }
        val number = callerNumber(details)
        val decision = runCatching {
            contactPolicy().decide(ContactPolicySources.get(this).rules(), Channel.CALL, Direction.INCOMING, number)
        }.getOrElse {
            // Never let a bug in Plainphone make the phone unable to ring: fail open for calls.
            Log.e(TAG, "screening failed, letting the call ring", it)
            respondToCall(details, CallResponse.Builder().build())
            return
        }
        if (decision.allowed) {
            respondToCall(details, CallResponse.Builder().build())
            return
        }
        Log.i(TAG, "blocked incoming call: ${decision}")
        TelephonyLog(this).recordBlocked(Channel.CALL, Direction.INCOMING, number)
        respondToCall(
            details,
            CallResponse.Builder()
                .setDisallowCall(true)
                .setRejectCall(true)
                .setSkipCallLog(true)
                .setSkipNotification(true)
                .build(),
        )
    }

    companion object {
        private const val TAG = "Plainphone"

        /** The caller's number, or null when it is hidden, restricted or unknown. */
        fun callerNumber(details: Call.Details): String? {
            if (details.handlePresentation != TelecomManager.PRESENTATION_ALLOWED) return null
            return details.handle?.schemeSpecificPart?.takeIf { it.isNotBlank() }
        }
    }
}
