// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.os.Build
import android.telecom.Call

/**
 * Ends [call], whoever asks: the child's hang-up button, SOS, or the in-call service blocking a number.
 *
 * Android 10's phone process crashes (a NullPointerException in ConnectionService.addConnection) when
 * an outgoing call is ended while Telecom is still binding the SIM's connection service: Telecom
 * aborts, then hands the aborted call over anyway (emulator runs 45043929153 and 45060357626, API 29).
 * The dialled call is then left on the modem with nothing in Telecom, so it connects unseen, and while
 * it is there Android drops incoming calls before any app sees them. So on Android 10 a call that is
 * still connecting is ended the moment it starts dialling, before the other phone can ring.
 */
fun endCall(call: Call) {
    if (Build.VERSION.SDK_INT >= 30 || callState(call) != Call.STATE_CONNECTING) {
        call.disconnect()
        return
    }
    call.registerCallback(object : Call.Callback() {
        override fun onStateChanged(call: Call, state: Int) {
            if (state == Call.STATE_CONNECTING) return
            call.unregisterCallback(this)
            if (state != Call.STATE_DISCONNECTED && state != Call.STATE_DISCONNECTING) call.disconnect()
        }
    })
}
