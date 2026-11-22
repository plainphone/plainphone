// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.Intent
import android.os.Build
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.InCallService
import android.util.Log
import androidx.annotation.RequiresApi
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.Decision
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.EmergencyNumbers
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.UnreadableRules
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.ui.InCallActivity

/**
 * The default phone app's call service. Telecom hands it every call on the
 * phone, also calls started from another app (the maker's dialer, a contact
 * card, a link). That makes it the place where outgoing calls to numbers that
 * are not approved are ended, whoever started them.
 */
class PlainphoneInCallService : InCallService() {
    private val callbacks = mutableMapOf<Call, Call.Callback>()

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
        // Telecom does not know the direction of a call it finds already on the modem, for example after
        // the phone process restarted with a call ringing (run 45060357626, API 29).
        val unknown = details.callDirection == Call.Details.DIRECTION_UNKNOWN
        val outgoing = details.callDirection == Call.Details.DIRECTION_OUTGOING
        val number = PlainphoneCallScreeningService.callerNumber(details)
            // Outgoing calls always have a number; take it even if presentation says otherwise.
            ?: if (outgoing || unknown) details.handle?.schemeSpecificPart else null

        // Calls Android itself flags as emergency (network-identified emergency, callback mode) are never touched.
        val flaggedEmergency = details.hasProperty(Call.Details.PROPERTY_NETWORK_IDENTIFIED_EMERGENCY_CALL) ||
            details.hasProperty(Call.Details.PROPERTY_EMERGENCY_CALLBACK_MODE)
        val rules = runCatching { ContactPolicySources.strictRules(this) }.getOrNull()
        // Rules that cannot be read: outgoing calls go only to the parents and emergency numbers (UnreadableRules).
        val decision = rules?.let {
            if (unknown) decideUnknownDirection(it, number)
            else contactPolicy().decide(it, Channel.CALL, if (outgoing) Direction.OUTGOING else Direction.INCOMING, number)
        } ?: if (outgoing) runCatching { UnreadableRules.outgoingCall(this, number) }.getOrDefault(Decision.Allow("rules unreadable")) else null
        if (decision != null && !decision.allowed && !flaggedEmergency) {
            Log.i(TAG, "ending call: $decision")
            // A call of unknown direction is logged as incoming and the child gets no "Call not allowed"
            // message: they did not dial it.
            TelephonyLog(this).recordBlocked(Channel.CALL, if (outgoing) Direction.OUTGOING else Direction.INCOMING, number)
            when {
                outgoing -> endCall(call)
                unknown -> call.disconnect() // Not offered as ringing, so there is nothing to reject.
                else -> call.reject(false, null)
            }
            if (outgoing) CallNotifications.showBlockedCall(this, number, rulesUnreadable = rules == null)
            return
        }

        // Silent bedtime: no ring screen, no heads-up. The call stays in the shade without a sound.
        // A bug here must never make a parent's call silent, so a failure counts as "rings".
        if (!outgoing && rules != null && !runCatching { contactPolicy().ringsAtBedtime(rules, number) }.getOrDefault(true)) {
            CallManager.markQuiet(call)
        }

        val opensWindow = outgoing && number != null && EmergencyNumbers.forContext(this).opensCallBackWindow(number)
        CallManager.add(call, rules?.contactFor(number)?.name)
        CallNotifications.update(this)
        val callback = object : Call.Callback() {
            override fun onStateChanged(call: Call, state: Int) {
                // Only a connected emergency call opens the call-back window, so the emergency
                // service can call back from any number. Dialling and hanging up does not.
                if (opensWindow && state == Call.STATE_ACTIVE) TelephonyLog(this@PlainphoneInCallService).recordEmergencyCall()
                CallNotifications.update(this@PlainphoneInCallService)
            }
        }
        callbacks[call] = callback
        call.registerCallback(callback)
        if (outgoing || (callState(call) != Call.STATE_RINGING && !CallManager.isQuiet(call))) {
            // The user just started this call, so Plainphone is in front and may open the screen.
            runCatching {
                startActivity(Intent(this, InCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
        }
    }

    /**
     * A call of unknown direction may be the child's own (also to an emergency number) or one ringing
     * in. It is kept if either would be allowed, so an emergency or a parent's call is never cut off.
     */
    private fun decideUnknownDirection(rules: ContactRules, number: String?): Decision {
        val asOutgoing = contactPolicy().decide(rules, Channel.CALL, Direction.OUTGOING, number)
        return if (asOutgoing.allowed) asOutgoing else contactPolicy().decide(rules, Channel.CALL, Direction.INCOMING, number)
    }

    override fun onCallRemoved(call: Call) {
        super.onCallRemoved(call)
        callbacks.remove(call)?.let(call::unregisterCallback)
        CallManager.remove(call)
        CallNotifications.update(this)
    }

    // Android 14+ reports mute and the sound route through these; older phones only call onCallAudioStateChanged.
    override fun onMuteStateChanged(isMuted: Boolean) = CallManager.onMuteChanged(isMuted)

    @RequiresApi(34)
    override fun onCallEndpointChanged(callEndpoint: CallEndpoint) = CallManager.onEndpointChanged(callEndpoint)

    @RequiresApi(34)
    override fun onAvailableCallEndpointsChanged(availableEndpoints: List<CallEndpoint>) =
        CallManager.onAvailableEndpointsChanged(availableEndpoints)

    @Deprecated("Replaced by call endpoints in Android 14; used on Android 10 to 13.")
    override fun onCallAudioStateChanged(audioState: CallAudioState) {
        @Suppress("DEPRECATION")
        super.onCallAudioStateChanged(audioState)
        if (Build.VERSION.SDK_INT < 34) CallManager.onLegacyAudioState(audioState)
    }

    private companion object {
        const val TAG = "Plainphone"
    }
}
