// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.os.OutcomeReceiver
import android.telecom.Call
import android.telecom.CallEndpoint
import android.telecom.CallEndpointException
import android.telecom.VideoProfile
import java.util.concurrent.Executor
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

/** What the in-call screen shows for one call. */
data class CallUi(
    val id: Int,
    val name: String?,
    val number: String?,
    val state: Int,
    val incoming: Boolean,
    /** System time when the call became active, for the timer. */
    val connectedAtMs: Long?,
)

/** Shared state between [PlainphoneInCallService] and the in-call screen. Lives in the app process. */
object CallManager {
    private val calls = mutableListOf<Call>()
    private val names = mutableMapOf<Call, String?>()
    private val _state = MutableStateFlow<List<CallUi>>(emptyList())
    val state: StateFlow<List<CallUi>> = _state.asStateFlow()

    /** Where the sound goes and whether the microphone is muted (API 34 call endpoints). */
    data class Audio(val muted: Boolean = false, val endpoint: CallEndpoint? = null, val available: List<CallEndpoint> = emptyList()) {
        val onSpeaker: Boolean get() = endpoint?.endpointType == CallEndpoint.TYPE_SPEAKER
    }

    private val _audio = MutableStateFlow(Audio())
    val audio: StateFlow<Audio> = _audio.asStateFlow()

    internal var service: PlainphoneInCallService? = null

    private val callback = object : Call.Callback() {
        override fun onStateChanged(call: Call, state: Int) = publish()
        override fun onDetailsChanged(call: Call, details: Call.Details) = publish()
    }

    @Synchronized
    fun add(call: Call, displayName: String?) {
        calls += call
        names[call] = displayName
        call.registerCallback(callback)
        publish()
    }

    @Synchronized
    fun remove(call: Call) {
        call.unregisterCallback(callback)
        calls -= call
        names -= call
        publish()
    }

    fun onMuteChanged(muted: Boolean) {
        _audio.value = _audio.value.copy(muted = muted)
    }

    fun onEndpointChanged(endpoint: CallEndpoint) {
        _audio.value = _audio.value.copy(endpoint = endpoint)
    }

    fun onAvailableEndpointsChanged(endpoints: List<CallEndpoint>) {
        _audio.value = _audio.value.copy(available = endpoints)
    }

    /** The call the screen should focus on: ringing first, then active, then anything else. */
    @Synchronized
    fun primary(): Call? = calls.firstOrNull { it.details.state == Call.STATE_RINGING }
        ?: calls.firstOrNull { it.details.state == Call.STATE_ACTIVE }
        ?: calls.firstOrNull()

    fun answer() = primary()?.answer(VideoProfile.STATE_AUDIO_ONLY)
    fun decline() = primary()?.reject(false, null)
    fun hangUp() = primary()?.disconnect()
    fun playDtmf(digit: Char) = primary()?.let { it.playDtmfTone(digit); it.stopDtmfTone() }

    fun setMuted(muted: Boolean) = service?.setMuted(muted)

    /** Speaker on, or back to the headset/earpiece. */
    fun setSpeaker(on: Boolean) {
        val available = _audio.value.available
        val target = if (on) {
            available.firstOrNull { it.endpointType == CallEndpoint.TYPE_SPEAKER }
        } else {
            listOf(CallEndpoint.TYPE_BLUETOOTH, CallEndpoint.TYPE_WIRED_HEADSET, CallEndpoint.TYPE_EARPIECE)
                .firstNotNullOfOrNull { type -> available.firstOrNull { it.endpointType == type } }
        } ?: return
        val direct = Executor { it.run() }
        service?.requestCallEndpointChange(target, direct, object : OutcomeReceiver<Void, CallEndpointException> {
            override fun onResult(result: Void?) = Unit
            override fun onError(error: CallEndpointException) = Unit
        })
    }

    @Synchronized
    private fun publish() {
        _state.value = calls.map { call ->
            val details = call.details
            CallUi(
                id = System.identityHashCode(call),
                name = names[call],
                number = PlainphoneCallScreeningService.callerNumber(details),
                state = details.state,
                incoming = details.callDirection == Call.Details.DIRECTION_INCOMING,
                connectedAtMs = details.connectTimeMillis.takeIf { it > 0 },
            )
        }
    }
}
