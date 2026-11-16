// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class ContactPolicyTest {
    private val dk = PhoneNumbers.countryForIso("dk")
    private val mum = ApprovedContact("Mum", "+4512345678")
    private val rules = ContactRules(enforced = true, contacts = listOf(mum), country = dk)
    // Like Android's list for a Danish SIM: 112 plus nothing else special.
    private val emergency = EmergencyCheck { EmergencyNumbers.check(it) { n -> n == "112" } }
    private var sinceEmergency: Long? = null
    private val policy = ContactPolicy(emergency) { sinceEmergency }

    private fun decide(channel: Channel, direction: Direction, number: String?, r: ContactRules = rules) =
        policy.decide(r, channel, direction, number)

    @Test
    fun `approved contact may call and text both ways, in any format`() {
        for (channel in Channel.entries) for (direction in Direction.entries) {
            assertThat(decide(channel, direction, "12 34 56 78").allowed).isTrue()
            assertThat(decide(channel, direction, "+45 1234 5678").allowed).isTrue()
            assertThat(decide(channel, direction, "004512345678").allowed).isTrue()
        }
    }

    @Test
    fun `unknown numbers are blocked both ways`() {
        for (channel in Channel.entries) for (direction in Direction.entries) {
            val d = decide(channel, direction, "+4587654321")
            assertThat(d.allowed).isFalse()
            assertThat(d).isEqualTo(Decision.Block("not an approved contact"))
        }
    }

    @Test
    fun `hidden callers are blocked`() {
        assertThat(decide(Channel.CALL, Direction.INCOMING, null)).isEqualTo(Decision.Block("hidden or unknown number"))
        assertThat(decide(Channel.CALL, Direction.INCOMING, "")).isEqualTo(Decision.Block("hidden or unknown number"))
    }

    @Test
    fun `text senders and service codes are blocked`() {
        assertThat(decide(Channel.SMS, Direction.INCOMING, "Netflix").allowed).isFalse()
        assertThat(decide(Channel.CALL, Direction.OUTGOING, "*100#").allowed).isFalse()
        assertThat(decide(Channel.CALL, Direction.OUTGOING, "1813").allowed).isFalse()
    }

    @Test
    fun `112, 911 and 114 always work, even with an empty list`() {
        val empty = rules.copy(contacts = emptyList())
        for (n in listOf("112", "911", "114")) {
            assertThat(decide(Channel.CALL, Direction.OUTGOING, n, empty).allowed).isTrue()
        }
    }

    @Test
    fun `the phone's own emergency list is honoured`() {
        val uk = ContactPolicy(EmergencyCheck { EmergencyNumbers.check(it) { n -> n == "999" } })
        assertThat(uk.decide(rules, Channel.CALL, Direction.OUTGOING, "999").allowed).isTrue()
        assertThat(policy.decide(rules, Channel.CALL, Direction.OUTGOING, "999").allowed).isFalse()
    }

    @Test
    fun `a crashing emergency lookup still lets 112 through`() {
        val broken = ContactPolicy(EmergencyCheck { EmergencyNumbers.check(it) { throw SecurityException("no") } })
        assertThat(broken.decide(rules, Channel.CALL, Direction.OUTGOING, "112").allowed).isTrue()
        assertThat(broken.decide(rules, Channel.CALL, Direction.OUTGOING, "999").allowed).isFalse()
    }

    @Test
    fun `everything is allowed while the lock is not active`() {
        val off = rules.copy(enforced = false)
        assertThat(decide(Channel.CALL, Direction.INCOMING, "+4587654321", off).allowed).isTrue()
        assertThat(decide(Channel.SMS, Direction.OUTGOING, "+4587654321", off).allowed).isTrue()
    }

    @Test
    fun `after an emergency call anyone may call back for an hour`() {
        sinceEmergency = 10 * 60_000L
        assertThat(decide(Channel.CALL, Direction.INCOMING, null).allowed).isTrue()
        assertThat(decide(Channel.CALL, Direction.INCOMING, "+4587654321").allowed).isTrue()
        // Only incoming calls: no outgoing calls or SMS to strangers.
        assertThat(decide(Channel.CALL, Direction.OUTGOING, "+4587654321").allowed).isFalse()
        assertThat(decide(Channel.SMS, Direction.INCOMING, "+4587654321").allowed).isFalse()
    }

    @Test
    fun `the call-back window closes after an hour`() {
        sinceEmergency = ContactPolicy.EMERGENCY_CALLBACK_WINDOW_MS + 1
        assertThat(decide(Channel.CALL, Direction.INCOMING, "+4587654321").allowed).isFalse()
        sinceEmergency = -5 // clock trouble: never treat as inside the window
        assertThat(decide(Channel.CALL, Direction.INCOMING, "+4587654321").allowed).isFalse()
    }

    @Test
    fun `contactFor finds the contact behind any format`() {
        assertThat(rules.contactFor("12345678")).isEqualTo(mum)
        assertThat(rules.contactFor("+4512345679")).isNull()
        assertThat(rules.contactFor(null)).isNull()
    }
}
