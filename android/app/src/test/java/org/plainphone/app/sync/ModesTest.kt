// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.home.HomeModel
import org.plainphone.app.home.WindowNotice
import org.robolectric.RobolectricTestRunner

/**
 * Modes (docs/modes.md) switch on the device clock in the phone's time zone, so they keep switching
 * offline. Every instant here is fixed; nothing depends on today's date. 2027-01-04 is a Monday.
 */
@RunWith(RobolectricTestRunner::class) // org.json is Android's
class ModesTest {
    private val cph = ZoneId.of("Europe/Copenhagen")
    private fun at(text: String): Instant = ZonedDateTime.of(LocalDateTime.parse(text), cph).toInstant()

    private val mum = """{"name":"Mum","number":"+4512345678","group":"family"}"""
    private val gran = """{"name":"Gran","number":"+4511111111","group":"family"}"""
    private val friend = """{"name":"Sam","number":"+4522222222","group":"friends"}"""
    private val coach = """{"name":"Coach","number":"+4533333333","group":"others"}"""

    private fun mode(id: String, preset: String, groups: String, quiet: Boolean = false, name: String? = null) =
        """{"id":"$id","preset":"$preset","name":${name?.let { "\"$it\"" } ?: "null"},"allApps":false,"allowedPackages":[],"contactGroups":$groups,"quiet":$quiet}"""

    private fun slot(id: String, modeId: String, days: String, start: String, end: String) =
        """{"id":"$id","modeId":"$modeId","days":$days,"start":"$start","end":"$end"}"""

    private val modesBlock = """
        {"enabled":true,"defaultModeId":"free","list":[
          ${mode("free", "free", """["family","friends","others"]""")},
          ${mode("school", "school", """["family"]""")},
          ${mode("homework", "homework", """["family","friends"]""", name = "Lektier")},
          ${mode("night", "night", "[]", quiet = true)}],
         "slots":[
          ${slot("s1", "school", "[1,2,3,4,5]", "08:00", "14:00")},
          ${slot("s2", "homework", "[1,2,3,4]", "16:00", "17:00")},
          ${slot("s3", "night", "[7,1,2,3,4]", "21:00", "07:00")}]}
    """.trimIndent()

    private fun rules(parents: String = "[$mum]", modes: String? = modesBlock, profile: String = "child"): ServerRules {
        val json = JSONObject(rulesJson(contacts = "[$mum,$gran,$friend,$coach]"))
        json.put("profile", profile)
        json.put("sos", JSONObject("""{"name":"Alex","parents":$parents}"""))
        if (modes != null) json.put("modes", JSONObject(modes))
        return ServerRules.parse(json.toString())
    }

    private fun names(list: List<ApprovedContact>) = list.map { it.name }

    @Test
    fun `the mode follows the weekly schedule, and outside it the default mode applies`() {
        val r = rules()
        assertThat(Modes.current(r, at("2027-01-04T10:00"))!!.mode!!.id).isEqualTo("school")
        assertThat(Modes.current(r, at("2027-01-04T10:00"))!!.until).isEqualTo(LocalTime.of(14, 0))
        assertThat(Modes.current(r, at("2027-01-04T16:30"))!!.mode!!.id).isEqualTo("homework")
        val free = Modes.current(r, at("2027-01-04T15:00"))!!
        assertThat(free.mode!!.id).isEqualTo("free")
        assertThat(free.isDefault).isTrue()
        assertThat(free.contactGroups).isNull()
        // Start inclusive, end exclusive.
        assertThat(Modes.current(r, at("2027-01-04T14:00"))!!.mode!!.id).isEqualTo("free")
        assertThat(Modes.current(r, at("2027-01-04T08:00"))!!.mode!!.id).isEqualTo("school")
    }

    @Test
    fun `a night slot crosses midnight and belongs to the day it starts`() {
        val r = rules()
        // Thursday 23:00 and Friday 06:59: Thursday's night.
        assertThat(Modes.current(r, at("2027-01-07T23:00"))!!.mode!!.id).isEqualTo("night")
        assertThat(Modes.current(r, at("2027-01-08T06:59"))!!.mode!!.id).isEqualTo("night")
        assertThat(Modes.current(r, at("2027-01-08T07:00"))!!.mode!!.id).isEqualTo("free")
        // Friday night is not on the plan.
        assertThat(Modes.current(r, at("2027-01-08T23:00"))!!.isDefault).isTrue()
    }

    @Test
    fun `the week wraps from Sunday night into Monday morning`() {
        val r = rules()
        assertThat(Modes.current(r, at("2027-01-10T22:00"))!!.mode!!.id).isEqualTo("night")
        assertThat(Modes.current(r, at("2027-01-11T06:00"))!!.mode!!.id).isEqualTo("night")
        assertThat(Modes.current(r, at("2027-01-11T09:00"))!!.mode!!.id).isEqualTo("school")
        // Saturday night is free, and so is Sunday morning.
        assertThat(Modes.current(r, at("2027-01-10T06:00"))!!.isDefault).isTrue()
    }

    @Test
    fun `slots keep wall-clock times on the nights the clocks change`() {
        val r = rules()
        // Spring forward: Sunday 2027-03-28, 02:00 becomes 03:00. Sunday night 21:00 to Monday 07:00 as usual.
        assertThat(Modes.current(r, at("2027-03-28T21:00"))!!.mode!!.id).isEqualTo("night")
        assertThat(Modes.current(r, at("2027-03-29T06:59"))!!.mode!!.id).isEqualTo("night")
        assertThat(Modes.current(r, at("2027-03-29T07:00"))!!.isDefault).isTrue()
        // Fall back: Sunday 2027-10-31, 03:00 becomes 02:00. The night still ends at 07:00 local on Monday.
        assertThat(Modes.current(r, at("2027-11-01T06:59"))!!.mode!!.id).isEqualTo("night")
        assertThat(Modes.current(r, at("2027-11-01T07:00"))!!.isDefault).isTrue()
        // The boundary after Sunday 20:00 is 21:00 local, also on the day the clocks went back.
        assertThat(Modes.nextBoundary(r, at("2027-10-31T20:00"))).isEqualTo(at("2027-10-31T21:00"))
        assertThat(Modes.nextBoundary(r, at("2027-03-28T20:00"))).isEqualTo(at("2027-03-28T21:00"))
    }

    @Test
    fun `the next switch is the next start or end of any slot, across midnight and the week`() {
        val r = rules()
        assertThat(Modes.nextBoundary(r, at("2027-01-04T10:00"))).isEqualTo(at("2027-01-04T14:00"))
        assertThat(Modes.nextBoundary(r, at("2027-01-04T14:00"))).isEqualTo(at("2027-01-04T16:00"))
        // Friday after school: next is Sunday 21:00, two days later.
        assertThat(Modes.nextBoundary(r, at("2027-01-08T15:00"))).isEqualTo(at("2027-01-10T21:00"))
        assertThat(Modes.nextBoundary(rules(modes = null), at("2027-01-08T15:00"))).isNull()
    }

    @Test
    fun `switching needs only the stored rules and the clock, so it works offline`() {
        // The same stored document, read again at later instants with no sync in between.
        val stored = rules()
        val day = listOf("2027-01-04T06:30", "2027-01-04T09:00", "2027-01-04T15:00", "2027-01-04T16:30", "2027-01-04T22:00")
            .map { Modes.current(stored, at(it))!!.mode!!.id }
        assertThat(day).containsExactly("night", "school", "free", "homework", "night").inOrder()
    }

    @Test
    fun `a mode narrows calls to its groups and always keeps the parents`() {
        val r = rules()
        val all = r.contacts
        assertThat(names(Modes.allowedContacts(r, all, at("2027-01-04T10:00")))).containsExactly("Mum", "Gran")
        assertThat(names(Modes.allowedContacts(r, all, at("2027-01-04T16:30")))).containsExactly("Mum", "Gran", "Sam")
        assertThat(names(Modes.allowedContacts(r, all, at("2027-01-04T15:00")))).containsExactly("Mum", "Gran", "Sam", "Coach")
        // Night allows no group: only the parent.
        assertThat(names(Modes.allowedContacts(r, all, at("2027-01-04T23:00")))).containsExactly("Mum")
    }

    @Test
    fun `a parent stays reachable even if the stored group says otherwise or the list lacks them`() {
        val dad = """{"name":"Dad","number":"+4587654321"}"""
        val r = rules(parents = "[$dad]")
        val night = at("2027-01-04T23:00")
        assertThat(names(Modes.allowedContacts(r, r.contacts, night))).containsExactly("Dad")
        val coachIsParent = rules(parents = """[{"name":"Coach","number":"+4533333333"}]""")
        assertThat(names(Modes.allowedContacts(coachIsParent, coachIsParent.contacts, night))).containsExactly("Coach")
    }

    @Test
    fun `with no parent marked, groups do not narrow the list, because the phone cannot tell who the parents are`() {
        val r = rules(parents = "[]")
        assertThat(Modes.allowedContacts(r, r.contacts, at("2027-01-04T23:00"))).isEqualTo(r.contacts)
    }

    @Test
    fun `with modes off, on a Self phone or with a broken block, every contact can call`() {
        val night = at("2027-01-04T23:00")
        val off = rules(modes = null)
        assertThat(off.modes).isNull()
        assertThat(Modes.allowedContacts(off, off.contacts, night)).isEqualTo(off.contacts)
        assertThat(Modes.current(off, night)).isNull()
        val self = rules(profile = "self")
        assertThat(Modes.allowedContacts(self, self.contacts, night)).isEqualTo(self.contacts)
        val broken = rules(modes = """{"enabled":true,"list":"nope"}""")
        assertThat(broken.modes).isNull()
        assertThat(Modes.allowedContacts(broken, broken.contacts, night)).isEqualTo(broken.contacts)
        assertThat(rules(modes = """{"enabled":false,"defaultModeId":null,"list":[],"slots":[]}""").modes).isNull()
    }

    @Test
    fun `two slots at once give only the groups both allow, quiet if either is, and name the quiet one`() {
        val overlapping = modesBlock.replace(
            "\"slots\":[",
            "\"slots\":[${slot("x", "homework", "[1]", "22:00", "23:30")},",
        )
        val r = rules(modes = overlapping)
        val both = Modes.current(r, at("2027-01-04T22:30"))!!
        assertThat(both.mode!!.id).isEqualTo("night")
        assertThat(both.quiet).isTrue()
        assertThat(both.contactGroups).isEmpty()
    }

    @Test
    fun `the home screen names the mode, and the default mode shows nothing`() {
        val r = rules()
        val school = HomeModel.build(emptyList(), r, at("2027-01-04T10:00")).notice!!
        assertThat(school.mode!!.id).isEqualTo("school")
        assertThat(school.until).isEqualTo(LocalTime.of(14, 0))
        assertThat(school.kind).isEqualTo(WindowNotice.Kind.SCHOOL)
        val homework = HomeModel.build(emptyList(), r, at("2027-01-04T16:30")).notice!!
        assertThat(homework.mode!!.name).isEqualTo("Lektier")
        assertThat(HomeModel.build(emptyList(), r, at("2027-01-04T15:00")).notice).isNull()
        // Without modes the old school time and bedtime notice is unchanged.
        val legacy = HomeModel.build(emptyList(), rules(modes = null), at("2027-01-04T10:00")).notice
        assertThat(legacy).isNull()
    }
}
