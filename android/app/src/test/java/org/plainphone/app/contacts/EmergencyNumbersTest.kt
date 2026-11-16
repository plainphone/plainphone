// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

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
    fun `ordinary numbers are not`() {
        val check = EmergencyNumbers.forContext(context)
        for (n in listOf("+4512345678", "1813", "", "abc")) assertThat(check.isEmergency(n)).isFalse()
    }
}
