// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SosDeliveryTest {
    @Test
    fun `the same queued report cannot claim a second SMS attempt`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = SosDelivery.prefs(context)
        val submitted = mutableListOf<String>()
        val numbers = listOf("+4512345678", "+4587654321", "+4512345678")
        val send: (String) -> Boolean = { number ->
            submitted.add(number)
            number == numbers.first()
        }
        assertThat(submitSosFallback(prefs, "report-a", 1_000, numbers, send)).isTrue()
        assertThat(submitSosFallback(prefs, "report-a", 2_000, numbers, send)).isFalse()
        assertThat(submitted).containsExactly("+4512345678", "+4587654321").inOrder()
        assertThat(submitSosFallback(prefs, "report-b", 2_000, numbers, send)).isTrue()
    }
}
