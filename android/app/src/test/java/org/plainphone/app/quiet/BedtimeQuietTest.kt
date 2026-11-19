// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.quiet

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PolicyConfig
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicy
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.Decision
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.EmergencyCheck
import org.plainphone.app.contacts.EmergencyNumbers
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.sync.EffectivePolicy
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner

/** Silent bedtime: who may still ring, and when the phone counts as silent (docs/bedtime.md). */
@RunWith(RobolectricTestRunner::class)
class BedtimeQuietTest {
    private val bedtime = """[{"id":"b1","kind":"bedtime","days":[1,2,3,4,5,6,7],"start":"21:00","end":"07:00","allowedPackages":[]}]"""
    private val school = """[{"id":"s1","kind":"school","days":[1,2,3,4,5,6,7],"start":"08:00","end":"15:00","allowedPackages":[]}]"""

    // Copenhagen is UTC+1 in January: 22:00 local is 21:00Z, noon local is 11:00Z.
    private val night = Instant.parse("2027-01-04T21:00:00Z")
    private val day = Instant.parse("2027-01-04T11:00:00Z")
    private val schoolHours = Instant.parse("2027-01-05T09:00:00Z")

    private fun rules(
        schedules: String = bedtime,
        extra: String = "",
        contacts: String = """[{"name":"Mum","number":"+4512345678"},{"name":"Friend","number":"+4587654321"}]""",
    ) = ServerRules.parse(rulesJson(schedules = schedules, contacts = contacts).replace("\"pollSeconds\":60", "$extra\"pollSeconds\":60"))

    private val parents = """"sos":{"name":"Alma","parents":[{"name":"Mum","number":"+4512345678"}]},"""

    @Test
    fun `silent bedtime is on by default, also for a server that does not say`() {
        assertThat(rules().silentBedtime).isTrue()
        assertThat(rules(extra = "\"silentBedtime\":false,").silentBedtime).isFalse()
    }

    @Test
    fun `the phone is silent in a bedtime window and not outside it`() {
        assertThat(BedtimeQuiet.silentNow(rules(), night)).isTrue()
        assertThat(BedtimeQuiet.silentNow(rules(), day)).isFalse()
    }

    @Test
    fun `school time is not silent`() {
        assertThat(BedtimeQuiet.silentNow(rules(schedules = school), schoolHours)).isFalse()
    }

    @Test
    fun `the parent can turn it off, and then bedtime is not silent`() {
        assertThat(BedtimeQuiet.silentNow(rules(extra = "\"silentBedtime\":false,"), night)).isFalse()
    }

    @Test
    fun `with no rules at all nothing is silent`() {
        assertThat(BedtimeQuiet.silentNow(null, night)).isFalse()
    }

    @Test
    fun `only the contacts marked as parents ring when someone is marked`() {
        assertThat(BedtimeQuiet.ringers(rules(extra = parents))).containsExactly(ApprovedContact("Mum", "+4512345678"))
    }

    @Test
    fun `when no parent is marked every approved contact rings, so a parent is never silenced by accident`() {
        assertThat(BedtimeQuiet.ringers(rules()).map { it.name }).containsExactly("Mum", "Friend")
    }

    @Test
    fun `the lock config carries it, and a bedtime start changes the fingerprint so the phone re-applies`() {
        val qr = PolicyConfig(dnsHost = "family.adguard-dns.com")
        val r = rules()
        val atNight = EffectivePolicy.merge(qr, r, night)
        val atNoon = EffectivePolicy.merge(qr, r, day)
        assertThat(atNight.server?.quietBedtime).isTrue()
        assertThat(atNoon.server?.quietBedtime).isFalse()
        assertThat(EffectivePolicy.fingerprint(atNight)).isNotEqualTo(EffectivePolicy.fingerprint(atNoon))
        // Turning the switch off while bedtime is on is a change too.
        val off = EffectivePolicy.merge(qr, rules(extra = "\"silentBedtime\":false,"), night)
        assertThat(off.server?.quietBedtime).isFalse()
        assertThat(off.server?.windowActive).isTrue()
        assertThat(EffectivePolicy.fingerprint(off)).isNotEqualTo(EffectivePolicy.fingerprint(atNight))
    }

    // --- Who rings -----------------------------------------------------------------

    private val dk = PhoneNumbers.countryForIso("dk")
    private val mum = ApprovedContact("Mum", "+4512345678")
    private val friend = ApprovedContact("Friend", "+4587654321")
    private val quietRules = ContactRules(
        enforced = true, contacts = listOf(mum, friend), country = dk,
        silentBedtime = true, bedtimeRingers = listOf(mum),
    )
    private var sinceEmergency: Long? = null
    private val policy = ContactPolicy(EmergencyCheck { EmergencyNumbers.check(it) { n -> n == "112" } }) { sinceEmergency }

    @Test
    fun `at bedtime a parent rings and a friend does not`() {
        assertThat(policy.ringsAtBedtime(quietRules, "+4512345678")).isTrue()
        assertThat(policy.ringsAtBedtime(quietRules, "12 34 56 78")).isTrue()
        assertThat(policy.ringsAtBedtime(quietRules, "+4587654321")).isFalse()
        assertThat(policy.ringsAtBedtime(quietRules, null)).isFalse()
    }

    @Test
    fun `an allowed friend is still allowed, only the ring is silenced`() {
        assertThat(policy.decide(quietRules, Channel.CALL, Direction.INCOMING, "+4587654321")).isInstanceOf(Decision.Allow::class.java)
    }

    @Test
    fun `outside bedtime everyone who is allowed rings`() {
        val day = quietRules.copy(silentBedtime = false)
        assertThat(policy.ringsAtBedtime(day, "+4587654321")).isTrue()
    }

    @Test
    fun `the call-back after an emergency call rings from any number`() {
        sinceEmergency = 5 * 60_000L
        assertThat(policy.ringsAtBedtime(quietRules, "+4587654321")).isTrue()
        assertThat(policy.ringsAtBedtime(quietRules, null)).isTrue()
        sinceEmergency = ContactPolicy.EMERGENCY_CALLBACK_WINDOW_MS + 1
        assertThat(policy.ringsAtBedtime(quietRules, null)).isFalse()
    }

    @Test
    fun `outgoing emergency calls are never touched by bedtime`() {
        assertThat(policy.decide(quietRules, Channel.CALL, Direction.OUTGOING, "112").allowed).isTrue()
    }
}
