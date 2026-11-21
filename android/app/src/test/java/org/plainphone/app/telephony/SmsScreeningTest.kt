// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.telephony

import android.app.Application
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.provider.Settings
import android.provider.Telephony
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Compat
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.sos.SosDeliveryTest.SmsPartsShadow
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The Android wiring around the contact rule: a blocked SMS is never shown, never sent. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [SmsPartsShadow::class])
class SmsScreeningTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val mum = "+4512345678"
    private val stranger = "+4587654321"

    @Before fun lock() {
        val dpm = shadowOf(context.getSystemService(DevicePolicyManager::class.java))
        dpm.setActiveAdmin(PlainphoneAdminReceiver.component(context))
        assertThat(dpm.setDeviceOwner(PlainphoneAdminReceiver.component(context))).isTrue()
        SyncStore(context).saveRules("test", rulesJson(), System.currentTimeMillis())
    }

    /** A GSM SMS-DELIVER PDU with the text "hi" from an international number. */
    private fun pdu(number: String): ByteArray {
        val digits = number.removePrefix("+")
        val semiOctets = (if (digits.length % 2 == 1) "${digits}F" else digits).chunked(2).joinToString("") { it.reversed() }
        val hex = "00" + "04" + "%02X".format(digits.length) + "91" + semiOctets + "00" + "00" + "62110221000000" + "02" + "E834"
        return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    private fun deliver(from: String) = SmsDeliverReceiver().onReceive(
        context,
        Intent(Telephony.Sms.Intents.SMS_DELIVER_ACTION)
            .putExtra("pdus", arrayOf<Any>(pdu(from)))
            .putExtra("format", "3gpp"),
    )

    private fun notifications() = shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications

    @Test fun `an SMS from a number that is not approved is dropped and logged`() {
        deliver(stranger)
        assertThat(notifications()).isEmpty()
        assertThat(TelephonyLog(context).blocked().map { it.number }).contains(stranger)
    }

    @Test fun `an SMS from an approved contact is shown`() {
        deliver(mum)
        assertThat(notifications()).isNotEmpty()
        assertThat(TelephonyLog(context).blocked()).isEmpty()
    }

    @Test fun `an SMS to a number that is not approved is never handed to the carrier`() {
        assertThat(SmsSender.send(context, stranger, "hello").allowed).isFalse()
        assertThat(shadowOf(Compat.smsManager(context)).lastSentMultipartTextMessageParams).isNull()
        assertThat(TelephonyLog(context).blocked().map { it.number }).contains(stranger)
    }

    @Test fun `the emergency call-back window lets anyone call for an hour, then closes`() {
        val policy = context.contactPolicy()
        val rules = ContactPolicySources.get(context).rules()
        fun strangerRings() = policy.decide(rules, Channel.CALL, Direction.INCOMING, stranger).allowed
        assertThat(strangerRings()).isFalse()
        TelephonyLog(context).recordEmergencyCall()
        assertThat(strangerRings()).isTrue()
        org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofMinutes(61))
        assertThat(strangerRings()).isFalse()
    }

    @Test fun `a reboot ends the emergency call-back window`() {
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 4)
        TelephonyLog(context).recordEmergencyCall()
        assertThat(TelephonyLog(context).sinceLastEmergencyMs()).isNotNull()
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 5)
        assertThat(TelephonyLog(context).sinceLastEmergencyMs()).isNull()
    }

    @Test fun `an SMS to an approved contact is sent`() {
        assertThat(SmsSender.send(context, mum, "hello").allowed).isTrue()
        assertThat(shadowOf(Compat.smsManager(context)).lastSentMultipartTextMessageParams?.destinationAddress).isEqualTo(mum)
    }
}
