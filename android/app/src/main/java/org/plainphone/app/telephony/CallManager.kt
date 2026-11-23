// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.os.Build
import android.os.OutcomeReceiver
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.CallEndpointException
import android.telecom.VideoProfile
import androidx.annotation.RequiresApi
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

    /**
     * Whether the microphone is muted and the sound goes to the speaker. Fed by call endpoints
     * on Android 14+ ([Endpoints]) and by CallAudioState before that.
     */
    data class Audio(val muted: Boolean = false, val onSpeaker: Boolean = false)

    private val _audio = MutableStateFlow(Audio())
    val audio: StateFlow<Audio> = _audio.asStateFlow()

    internal var service: PlainphoneInCallService? = null

    private val callback = object : Call.Callback() {
        override fun onStateChanged(call: Call, state: Int) = publish()
        override fun onDetailsChanged(call: Call, details: Call.Details) = publish()
    }

    /** Incoming calls that must not ring or light the screen: silent bedtime (docs/bedtime.md). */
    private val quietCalls = mutableSetOf<Call>()

    @Synchronized
    fun markQuiet(call: Call) {
        quietCalls += call
    }

    @Synchronized
    fun isQuiet(call: Call): Boolean = call in quietCalls

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
        quietCalls -= call
        publish()
    }

    fun onMuteChanged(muted: Boolean) {
        _audio.value = _audio.value.copy(muted = muted)
    }

    @RequiresApi(34)
    fun onEndpointChanged(endpoint: CallEndpoint) {
        _audio.value = _audio.value.copy(onSpeaker = endpoint.endpointType == CallEndpoint.TYPE_SPEAKER)
    }

    @RequiresApi(34)
    fun onAvailableEndpointsChanged(endpoints: List<CallEndpoint>) {
        Endpoints.available = endpoints
    }

    /** Android 10 to 13: route and mute come from the old audio state. */
    fun onLegacyAudioState(state: CallAudioState) {
        legacyRoutes = state.supportedRouteMask
        _audio.value = Audio(muted = state.isMuted, onSpeaker = state.route == CallAudioState.ROUTE_SPEAKER)
    }

    private var legacyRoutes = 0

    /** The call the screen should focus on: ringing first, then active, then anything else. */
    @Synchronized
    fun primary(): Call? = calls.firstOrNull { callState(it) == Call.STATE_RINGING }
        ?: calls.firstOrNull { callState(it) == Call.STATE_ACTIVE }
        ?: calls.firstOrNull()

    fun answer() = primary()?.answer(VideoProfile.STATE_AUDIO_ONLY)
    fun decline() = primary()?.reject(false, null)
    /** Hang-ups go through [endCall], so a call still connecting cannot crash Android 10's phone process. */
    fun hangUp() = primary()?.let(::endCall)
    @Synchronized
    fun disconnect(id: Int) {
        calls.firstOrNull { System.identityHashCode(it) == id }?.let(::endCall)
    }
    fun playDtmf(digit: Char) = primary()?.let { it.playDtmfTone(digit); it.stopDtmfTone() }

    fun setMuted(muted: Boolean) = service?.setMuted(muted)

    /** Speaker on, or back to the headset/earpiece. */
    fun setSpeaker(on: Boolean) {
        val service = service ?: return
        if (Build.VERSION.SDK_INT >= 34) {
            Endpoints.setSpeaker(service, on)
        } else {
            val route = if (on) {
                CallAudioState.ROUTE_SPEAKER
            } else {
                listOf(CallAudioState.ROUTE_BLUETOOTH, CallAudioState.ROUTE_WIRED_HEADSET, CallAudioState.ROUTE_EARPIECE)
                    .firstOrNull { legacyRoutes and it != 0 } ?: CallAudioState.ROUTE_WIRED_OR_EARPIECE
            }
            @Suppress("DEPRECATION") // The routing API before call endpoints (Android 14).
            service.setAudioRoute(route)
        }
    }

    /** Android 14+ call endpoints. Only touched behind a version check, so the class never loads on older phones. */
    @RequiresApi(34)
    private object Endpoints {
        var available: List<CallEndpoint> = emptyList()

        fun setSpeaker(service: PlainphoneInCallService, on: Boolean) {
            val target = if (on) {
                available.firstOrNull { it.endpointType == CallEndpoint.TYPE_SPEAKER }
            } else {
                listOf(CallEndpoint.TYPE_BLUETOOTH, CallEndpoint.TYPE_WIRED_HEADSET, CallEndpoint.TYPE_EARPIECE)
                    .firstNotNullOfOrNull { type -> available.firstOrNull { it.endpointType == type } }
            } ?: return
            val direct = Executor { it.run() }
            service.requestCallEndpointChange(target, direct, object : OutcomeReceiver<Void, CallEndpointException> {
                override fun onResult(result: Void?) = Unit
                override fun onError(error: CallEndpointException) = Unit
            })
        }
    }

    @Synchronized
    private fun publish() {
        _state.value = calls.map { call ->
            val details = call.details
            CallUi(
                id = System.identityHashCode(call),
                name = names[call],
                number = PlainphoneCallScreeningService.callerNumber(details),
                state = callState(call),
                incoming = details.callDirection == Call.Details.DIRECTION_INCOMING,
                connectedAtMs = details.connectTimeMillis.takeIf { it > 0 },
            )
        }
    }
}

/** Call.Details.getState() arrived in Android 12; Call.getState() is the same value before that. */
fun callState(call: Call): Int =
    if (Build.VERSION.SDK_INT >= 31) {
        call.details.state
    } else {
        @Suppress("DEPRECATION")
        call.state
    }
