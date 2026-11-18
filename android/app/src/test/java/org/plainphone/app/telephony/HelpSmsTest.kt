// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.HelpDirectory
import org.plainphone.app.contacts.Helpline
import org.plainphone.app.contacts.Inbound
import org.plainphone.app.contacts.PhoneNumbers
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class HelpSmsTest {
    private val number = "116111"
    private val rules = ContactRules(
        true, emptyList(), PhoneNumbers.countryForIso("DK"),
        HelpDirectory(lines = listOf(Helpline("BørneTelefonen", null, number, null, smsInbound = Inbound.REPLY_ONLY))),
    )

    private fun message(id: Long, sent: Boolean = false) =
        SmsMessage(id, number, "message $id", id, outgoing = sent, failed = false, read = false, sent = sent)

    @Test
    fun `unverified SMS and marked reply use separate headings and threads`() {
        val ordinary = ApprovedContact("Approved contact", number)
        val overlapping = rules.copy(contacts = listOf(ordinary))
        val messages = listOf(message(3), message(2), message(1, sent = true))
        val classified = smsThreads(messages, overlapping, setOf("2"), legacyThrough = 0)
        assertThat(classified.map { (thread, _) -> thread.contact(overlapping)?.name })
            .containsExactly("Approved contact", "BørneTelefonen", "BørneTelefonen").inOrder()
        assertThat(classified.filter { it.first.kind == SmsThreadKind.HELP }.map { it.second.id })
            .containsExactly(2L, 1L)
    }

    @Test
    fun `pre-upgrade replies after a sent SMS are visible only under their number`() {
        val messages = listOf(message(4), message(3), message(2, sent = true), message(1))
        val classified = smsThreads(messages, rules, emptySet(), legacyThrough = 3)
        val archived = classified.filter { it.first.kind == SmsThreadKind.LEGACY }.single()
        assertThat(archived.second.id).isEqualTo(3L)
        assertThat(archived.first.contact(rules)?.name).isEqualTo(number)
        assertThat(classified.map { it.second.id }).containsExactly(3L, 2L)
    }

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
