// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.app.Notification
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.net.Uri
import android.os.Looper
import android.telecom.Call
import android.telecom.TelecomManager
import com.google.common.truth.Truth.assertThat
import java.lang.reflect.Proxy
import java.time.Duration
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.LocalContactPolicySource
import org.plainphone.app.contacts.TelephonyLog
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock
import org.robolectric.util.ReflectionHelpers
import org.robolectric.util.ReflectionHelpers.ClassParameter

/**
 * A call another app places to a number that is not approved is ended by the in-call service. On
 * Android 10, ending it while Telecom is still connecting it crashes the phone process (emulator run
 * 45043929153), so there it is ended as soon as it dials. The same holds for the child's hang-up and SOS.
 */
@RunWith(RobolectricTestRunner::class)
class OutgoingCallEndTest {
    private val stranger = "+12025550102"
    private val approved = "+12025550123"
    private val service = Robolectric.buildService(PlainphoneInCallService::class.java).create().get()
    private val ended = mutableListOf<String>()

    @Before fun forgetDials() = RecentDials.clear()

    private fun strongPhone() {
        val dpm = service.getSystemService(DevicePolicyManager::class.java)
        val admin = PlainphoneAdminReceiver.component(service)
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
        LocalContactPolicySource(service).seedIfEmpty(listOf(ApprovedContact("Approved", approved)))
    }

    /** A real framework Call whose Telecom side records each hang-up. */
    private fun outgoingCall(number: String, state: Int, direction: Int = Call.Details.DIRECTION_OUTGOING): Call {
        val adapterType = Class.forName("com.android.internal.telecom.IInCallAdapter")
        val telecom = Proxy.newProxyInstance(adapterType.classLoader, arrayOf(adapterType)) { _, method, args ->
            if (method.name == "disconnectCall") ended += args[0] as String
            null
        }
        val inCallAdapter = Class.forName("android.telecom.InCallAdapter")
        val adapter = ReflectionHelpers.callConstructor(inCallAdapter, ClassParameter(adapterType, telecom))
        val call = ReflectionHelpers.callConstructor(
            Call::class.java,
            ClassParameter(Class.forName("android.telecom.Phone"), null),
            ClassParameter.from(String::class.java, "TC@1"),
            ClassParameter(inCallAdapter, adapter),
            ClassParameter.from(String::class.java, "com.android.shell"),
            ClassParameter.from(Int::class.javaPrimitiveType, 29),
        )
        val details = ReflectionHelpers.callConstructor(Call.Details::class.java)
        ReflectionHelpers.setField(details, "mTelecomCallId", "TC@1")
        ReflectionHelpers.setField(details, "mHandle", Uri.fromParts("tel", number, null))
        ReflectionHelpers.setField(details, "mHandlePresentation", TelecomManager.PRESENTATION_ALLOWED)
        ReflectionHelpers.setField(details, "mCallDirection", direction)
        ReflectionHelpers.setField(call, "mDetails", details)
        setState(call, state)
        return call
    }

    /** Before Android 12 the state lives on the call, from then on on its details. */
    private fun setState(call: Call, state: Int) {
        ReflectionHelpers.setField(call, "mState", state)
        if (android.os.Build.VERSION.SDK_INT >= 31) ReflectionHelpers.setField(call.details, "mState", state)
    }

    private fun Call.moveTo(state: Int) {
        setState(this, state)
        ReflectionHelpers.callInstanceMethod<Unit>(this, "fireStateChanged", ClassParameter.from(Int::class.javaPrimitiveType, state))
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Config(sdk = [29])
    @Test fun `on Android 10 a connecting call to a stranger is ended once it dials, and logged at once`() {
        strongPhone()
        val call = outgoingCall(stranger, Call.STATE_CONNECTING)
        service.onCallAdded(call)
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(ended).isEmpty()
        assertThat(TelephonyLog(service).blocked().map { it.channel to it.direction })
            .containsExactly(Channel.CALL to Direction.OUTGOING)

        call.moveTo(Call.STATE_DIALING)
        assertThat(ended).containsExactly("TC@1")
        call.moveTo(Call.STATE_DISCONNECTING)
        assertThat(ended).containsExactly("TC@1")
    }

    @Config(sdk = [29])
    @Test fun `on Android 10 a call Telecom ends itself while connecting is not hung up again`() {
        strongPhone()
        val call = outgoingCall(stranger, Call.STATE_CONNECTING)
        service.onCallAdded(call)
        call.moveTo(Call.STATE_DISCONNECTED)
        assertThat(ended).isEmpty()
    }

    @Config(sdk = [29, 34])
    @Test fun `a dialling call to a stranger is ended at once`() {
        strongPhone()
        service.onCallAdded(outgoingCall(stranger, Call.STATE_DIALING))
        assertThat(ended).containsExactly("TC@1")
    }

    @Config(sdk = [34])
    @Test fun `on Android 14 a connecting call to a stranger is ended at once`() {
        strongPhone()
        service.onCallAdded(outgoingCall(stranger, Call.STATE_CONNECTING))
        assertThat(ended).containsExactly("TC@1")
    }

    /**
     * The child's own hang-up, tapped right after dialling (run 45060357626, API 29: 114 hung up in
     * state CONNECTING). Ended at once it crashed the phone process and left 114 live on the modem.
     */
    @Config(sdk = [29])
    @Test fun `on Android 10 hanging up a connecting call waits until it dials`() {
        strongPhone()
        val call = outgoingCall(approved, Call.STATE_CONNECTING)
        service.onCallAdded(call)
        try {
            CallManager.hangUp()
            shadowOf(Looper.getMainLooper()).idle()
            assertThat(ended).isEmpty()
            call.moveTo(Call.STATE_DIALING)
            assertThat(ended).containsExactly("TC@1")
        } finally {
            service.onCallRemoved(call)
        }
    }

    @Config(sdk = [29])
    @Test fun `on Android 10 SOS ending a connecting call also waits until it dials`() {
        strongPhone()
        val call = outgoingCall(approved, Call.STATE_CONNECTING)
        service.onCallAdded(call)
        try {
            CallManager.disconnect(CallManager.state.value.single().id)
            shadowOf(Looper.getMainLooper()).idle()
            assertThat(ended).isEmpty()
            call.moveTo(Call.STATE_DIALING)
            assertThat(ended).containsExactly("TC@1")
        } finally {
            service.onCallRemoved(call)
        }
    }

    @Config(sdk = [29, 34])
    @Test fun `hanging up a dialling call ends it at once`() {
        strongPhone()
        val call = outgoingCall(approved, Call.STATE_DIALING)
        service.onCallAdded(call)
        try {
            CallManager.hangUp()
            assertThat(ended).containsExactly("TC@1")
        } finally {
            service.onCallRemoved(call)
        }
    }

    /**
     * Run 45060357626, API 29: the phone process restarted with a stranger ringing, and Telecom handed
     * the call over with an unknown direction. It was logged as an outgoing call the child never made.
     */
    @Config(sdk = [29, 34])
    @Test fun `a stranger's call of unknown direction is ended and logged as incoming, with no message to the child`() {
        strongPhone()
        service.onCallAdded(outgoingCall(stranger, Call.STATE_NEW, Call.Details.DIRECTION_UNKNOWN))
        assertThat(ended).containsExactly("TC@1")
        assertThat(TelephonyLog(service).blocked().map { it.channel to it.direction })
            .containsExactly(Channel.CALL to Direction.INCOMING)
        assertThat(shadowOf(service.getSystemService(NotificationManager::class.java)).allNotifications).isEmpty()
    }

    /** Issue #273: the child's own call that the phone process restart handed back without a direction. */
    @Config(sdk = [29, 34])
    @Test fun `a call of unknown direction to a number the child just dialled is an outgoing block with the message`() {
        strongPhone()
        RecentDials.record("+1 202 555 0102")
        service.onCallAdded(outgoingCall(stranger, Call.STATE_DIALING, Call.Details.DIRECTION_UNKNOWN))
        assertThat(ended).containsExactly("TC@1")
        assertThat(TelephonyLog(service).blocked().map { it.channel to it.direction })
            .containsExactly(Channel.CALL to Direction.OUTGOING)
        val shown = shadowOf(service.getSystemService(NotificationManager::class.java)).allNotifications
        assertThat(shown.map { it.extras.getString(Notification.EXTRA_TITLE) }).containsExactly("Call not allowed")
    }

    @Config(sdk = [29])
    @Test fun `a dial older than a minute does not make a stranger's call of unknown direction outgoing`() {
        strongPhone()
        RecentDials.record(stranger)
        ShadowSystemClock.advanceBy(Duration.ofMillis(RecentDials.WINDOW_MS + 1))
        service.onCallAdded(outgoingCall(stranger, Call.STATE_NEW, Call.Details.DIRECTION_UNKNOWN))
        assertThat(ended).containsExactly("TC@1")
        assertThat(TelephonyLog(service).blocked().map { it.channel to it.direction })
            .containsExactly(Channel.CALL to Direction.INCOMING)
    }

    @Config(sdk = [29])
    @Test fun `a blocked outgoing call that comes back without a direction stays outgoing`() {
        strongPhone()
        // Another app dialled the stranger; the in-call service sees it as outgoing first (run 45060357626).
        service.onCallAdded(outgoingCall(stranger, Call.STATE_DIALING))
        service.onCallAdded(outgoingCall(stranger, Call.STATE_DIALING, Call.Details.DIRECTION_UNKNOWN))
        assertThat(ended).containsExactly("TC@1", "TC@1")
        assertThat(TelephonyLog(service).blocked().map { it.direction })
            .containsExactly(Direction.OUTGOING, Direction.OUTGOING)
    }

    @Config(sdk = [29])
    @Test fun `an approved call of unknown direction right after dialling it is kept`() {
        strongPhone()
        RecentDials.record(approved)
        val call = outgoingCall(approved, Call.STATE_DIALING, Call.Details.DIRECTION_UNKNOWN)
        service.onCallAdded(call)
        service.onCallRemoved(call)
        assertThat(ended).isEmpty()
        assertThat(TelephonyLog(service).blocked()).isEmpty()
    }

    @Config(sdk = [29])
    @Test fun `an emergency or approved call of unknown direction is kept`() {
        strongPhone()
        for (number in listOf("112", approved)) {
            val call = outgoingCall(number, Call.STATE_NEW, Call.Details.DIRECTION_UNKNOWN)
            service.onCallAdded(call)
            service.onCallRemoved(call)
        }
        assertThat(ended).isEmpty()
        assertThat(TelephonyLog(service).blocked()).isEmpty()
    }

    @Config(sdk = [34])
    @Test fun `on Android 14 hanging up a connecting call ends it at once`() {
        strongPhone()
        val call = outgoingCall(approved, Call.STATE_CONNECTING)
        service.onCallAdded(call)
        try {
            CallManager.hangUp()
            assertThat(ended).containsExactly("TC@1")
        } finally {
            service.onCallRemoved(call)
        }
    }
}
