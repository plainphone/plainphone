// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HelpSmsTest {
    @Test
    fun `last-part success cannot hide another part failure`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val receipts = SmsSendReceipts(context)
        assertThat(receipts.start("failed", 2)).isTrue()
        assertThat(receipts.receive("failed", 1, true)).isNull()
        assertThat(SmsSendReceipts(context).receive("failed", 0, false)).isFalse()
        assertThat(receipts.receive("failed", 1, true)).isNull()
    }

    @Test
    fun `all distinct parts must succeed once in any order`() {
        val receipts = SmsSendReceipts(ApplicationProvider.getApplicationContext())
        assertThat(receipts.start("success", 2)).isTrue()
        assertThat(receipts.receive("success", 1, true)).isNull()
        assertThat(receipts.receive("success", 1, true)).isNull()
        assertThat(receipts.receive("success", 0, true)).isTrue()
        assertThat(receipts.receive("success", 0, true)).isNull()
    }
}
