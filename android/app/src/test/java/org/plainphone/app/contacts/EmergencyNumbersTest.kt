// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.Manifest
import android.app.Application
import android.content.Context
import android.content.Intent
import android.telecom.TelecomManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ui.placeCall
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/** Runs the Android wiring (TelephonyManager) under Robolectric. */
@RunWith(RobolectricTestRunner::class)
class EmergencyNumbersTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `112, 911 and 114 are emergency numbers on any phone`() {
        val check = EmergencyNumbers.forContext(context)
        for (n in listOf("112", "911", "114", "tel:112", " 112 ")) assertThat(check.isEmergency(n)).isTrue()
    }

    @Test
    fun `the phone app hands 112 to Android Telecom`() {
        shadowOf(ApplicationProvider.getApplicationContext<Application>()).grantPermissions(Manifest.permission.CALL_PHONE)
        val telecom = shadowOf(context.getSystemService(TelecomManager::class.java))
        telecom.setCallPhonePermission(true)

        assertThat(placeCall(context, "112")).isNull()
        assertThat(telecom.onlyOutgoingCall.address.toString()).isEqualTo("tel:112")
    }

    @Test
    fun `the emergency dialer fallback opens the emergency number in the keypad`() {
        val intent = org.plainphone.app.sos.emergencyKeypadIntent()
        assertThat(intent.action).isEqualTo(Intent.ACTION_DIAL)
        assertThat(intent.data?.schemeSpecificPart).isEqualTo("112")
        assertThat(EmergencyNumbers.forContext(context).isEmergency(intent.data!!.schemeSpecificPart)).isTrue()
    }

    @Test
    fun `ordinary numbers are not`() {
        val check = EmergencyNumbers.forContext(context)
        for (n in listOf("+4512345678", "1813", "", "abc")) assertThat(check.isEmergency(n)).isFalse()
    }
}
