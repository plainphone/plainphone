// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.Intent
import android.telecom.Call
import android.telecom.CallEndpoint
import android.telecom.InCallService
import android.util.Log
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.EmergencyNumbers
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.ui.InCallActivity

/**
 * The default phone app's call service. Telecom hands it every call on the
 * phone, also calls started from another app (the maker's dialer, a contact
 * card, a link). That makes it the place where outgoing calls to numbers that
 * are not approved are ended, whoever started them.
 */
class PlainphoneInCallService : InCallService() {

    override fun onCreate() {
        super.onCreate()
        CallManager.service = this
    }

    override fun onDestroy() {
        if (CallManager.service === this) CallManager.service = null
        super.onDestroy()
    }

    override fun onCallAdded(call: Call) {
        super.onCallAdded(call)
        val details = call.details
        val outgoing = details.callDirection != Call.Details.DIRECTION_INCOMING
        val number = PlainphoneCallScreeningService.callerNumber(details)
            // Outgoing calls always have a number; take it even if presentation says otherwise.
            ?: if (outgoing) details.handle?.schemeSpecificPart else null

        if (outgoing && number != null && EmergencyNumbers.forContext(this).isEmergency(number)) {
            // Opens the call-back window, so the emergency service can call back from any number.
            TelephonyLog(this).recordEmergencyCall()
        }

        // Calls Android itself flags as emergency (network-identified emergency, callback mode) are never touched.
        val flaggedEmergency = details.hasProperty(Call.Details.PROPERTY_NETWORK_IDENTIFIED_EMERGENCY_CALL) ||
            details.hasProperty(Call.Details.PROPERTY_EMERGENCY_CALLBACK_MODE)
        val rules = runCatching { ContactPolicySources.get(this).rules() }.getOrNull()
        val decision = rules?.let {
            contactPolicy().decide(it, Channel.CALL, if (outgoing) Direction.OUTGOING else Direction.INCOMING, number)
        }
        if (decision != null && !decision.allowed && !flaggedEmergency) {
            Log.i(TAG, "ending call: $decision")
            TelephonyLog(this).recordBlocked(Channel.CALL, if (outgoing) Direction.OUTGOING else Direction.INCOMING, number)
            if (outgoing) call.disconnect() else call.reject(false, null)
            if (outgoing) CallNotifications.showBlockedCall(this, number)
            return
        }

        CallManager.add(call, rules?.contactFor(number)?.name)
        CallNotifications.update(this)
        call.registerCallback(object : Call.Callback() {
            override fun onStateChanged(call: Call, state: Int) = CallNotifications.update(this@PlainphoneInCallService)
        })
        if (outgoing || details.state != Call.STATE_RINGING) {
            // The user just started this call, so Plainphone is in front and may open the screen.
            runCatching {
                startActivity(Intent(this, InCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
    }

    override fun onCallRemoved(call: Call) {
        super.onCallRemoved(call)
        CallManager.remove(call)
        CallNotifications.update(this)
    }

    override fun onMuteStateChanged(isMuted: Boolean) = CallManager.onMuteChanged(isMuted)

    override fun onCallEndpointChanged(callEndpoint: CallEndpoint) = CallManager.onEndpointChanged(callEndpoint)

    override fun onAvailableCallEndpointsChanged(availableEndpoints: List<CallEndpoint>) =
        CallManager.onAvailableEndpointsChanged(availableEndpoints)

    private companion object {
        const val TAG = "Plainphone"
    }
}
