// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Test

class SchedulesTest {
    private val cph = ZoneId.of("Europe/Copenhagen")

    private fun at(text: String, zone: ZoneId = cph): Instant = ZonedDateTime.of(LocalDateTime.parse(text), zone).toInstant()

    private fun schedule(days: Set<Int>, start: String, end: String, allowed: Set<String> = emptySet(), id: String = "s") =
        Schedule(id, "school", days, LocalTime.parse(start), LocalTime.parse(end), allowed)

    private val weekdays = setOf(1, 2, 3, 4, 5)
    private val school = schedule(weekdays, "08:00", "14:00")
    // 2027-01-04 is a Monday.

    @Test
    fun `a daytime window applies on its days only, start inclusive and end exclusive`() {
        assertThat(Schedules.active(listOf(school), at("2027-01-04T07:59:59"), cph)).isEmpty()
        assertThat(Schedules.active(listOf(school), at("2027-01-04T08:00:00"), cph)).containsExactly(school)
        assertThat(Schedules.active(listOf(school), at("2027-01-04T13:59:59"), cph)).containsExactly(school)
        assertThat(Schedules.active(listOf(school), at("2027-01-04T14:00:00"), cph)).isEmpty()
        // Saturday.
        assertThat(Schedules.active(listOf(school), at("2027-01-09T10:00:00"), cph)).isEmpty()
    }

    @Test
    fun `a window over midnight belongs to the day it starts`() {
        // Bedtime Sunday to Thursday nights, 21:00 to 07:00.
        val bedtime = schedule(setOf(7, 1, 2, 3, 4), "21:00", "07:00")
        // Sunday evening and Monday morning: one night.
        assertThat(Schedules.active(listOf(bedtime), at("2027-01-03T22:00:00"), cph)).containsExactly(bedtime)
        assertThat(Schedules.active(listOf(bedtime), at("2027-01-04T06:59:00"), cph)).containsExactly(bedtime)
        assertThat(Schedules.active(listOf(bedtime), at("2027-01-04T07:00:00"), cph)).isEmpty()
        // Friday evening is not listed, so Friday night is free...
        assertThat(Schedules.active(listOf(bedtime), at("2027-01-08T22:00:00"), cph)).isEmpty()
        // ...but Friday morning still belongs to Thursday night.
        assertThat(Schedules.active(listOf(bedtime), at("2027-01-08T06:00:00"), cph)).containsExactly(bedtime)
        // Saturday morning belongs to Friday night: free.
        assertThat(Schedules.active(listOf(bedtime), at("2027-01-09T06:00:00"), cph)).isEmpty()
    }

    @Test
    fun `the phone's time zone decides, not UTC`() {
        val instant = Instant.parse("2027-01-04T07:30:00Z") // 08:30 in Copenhagen, 07:30 in London
        assertThat(Schedules.active(listOf(school), instant, cph)).containsExactly(school)
        assertThat(Schedules.active(listOf(school), instant, ZoneId.of("Europe/London"))).isEmpty()
    }

    @Test
    fun `bedtime keeps wall-clock times on the nights the clocks change`() {
        val bedtime = schedule((1..7).toSet(), "21:00", "07:00")
        // Spring: 28 March 2027 the clocks jump from 02:00 to 03:00.
        assertThat(Schedules.active(listOf(bedtime), at("2027-03-28T01:30:00"), cph)).containsExactly(bedtime)
        assertThat(Schedules.active(listOf(bedtime), at("2027-03-28T03:30:00"), cph)).containsExactly(bedtime)
        assertThat(Schedules.active(listOf(bedtime), at("2027-03-28T06:59:00"), cph)).containsExactly(bedtime)
        assertThat(Schedules.active(listOf(bedtime), at("2027-03-28T07:00:00"), cph)).isEmpty()
        // The night is one hour shorter: from 21:00 CET to 07:00 CEST is 9 hours.
        val start = Schedules.nextBoundary(listOf(bedtime), at("2027-03-27T20:00:00"), cph)!!
        val end = Schedules.nextBoundary(listOf(bedtime), start, cph)!!
        assertThat(start).isEqualTo(Instant.parse("2027-03-27T20:00:00Z"))
        assertThat(end).isEqualTo(Instant.parse("2027-03-28T05:00:00Z"))

        // Autumn: 31 October 2027, 02:00-03:00 happens twice. Both times are inside bedtime.
        val first = Instant.parse("2027-10-31T00:30:00Z") // 02:30 CEST
        val second = Instant.parse("2027-10-31T01:30:00Z") // 02:30 CET
        assertThat(Schedules.active(listOf(bedtime), first, cph)).containsExactly(bedtime)
        assertThat(Schedules.active(listOf(bedtime), second, cph)).containsExactly(bedtime)
        // And it ends at 07:00 CET, a 11-hour night.
        assertThat(Schedules.nextBoundary(listOf(bedtime), second, cph)).isEqualTo(Instant.parse("2027-10-31T06:00:00Z"))
    }

    @Test
    fun `a window starting in the skipped spring hour starts when the clocks jump`() {
        val night = schedule(setOf(7), "02:30", "04:00") // Sunday 28 March 2027
        assertThat(Schedules.active(listOf(night), Instant.parse("2027-03-28T00:59:00Z"), cph)).isEmpty() // 01:59 CET
        assertThat(Schedules.active(listOf(night), Instant.parse("2027-03-28T01:00:00Z"), cph)).containsExactly(night) // 03:00 CEST
        assertThat(Schedules.nextBoundary(listOf(night), Instant.parse("2027-03-28T00:00:00Z"), cph))
            .isEqualTo(Instant.parse("2027-03-28T01:00:00Z"))
    }

    @Test
    fun `next boundary skips days without the window and wraps the week`() {
        // Friday 15:00: next is Monday 08:00.
        assertThat(Schedules.nextBoundary(listOf(school), at("2027-01-08T15:00:00"), cph)).isEqualTo(at("2027-01-11T08:00:00"))
        // Inside the window: its end.
        assertThat(Schedules.nextBoundary(listOf(school), at("2027-01-04T09:00:00"), cph)).isEqualTo(at("2027-01-04T14:00:00"))
        assertThat(Schedules.nextBoundary(emptyList(), at("2027-01-04T09:00:00"), cph)).isNull()
    }

    @Test
    fun `overlapping windows only allow what both allow`() {
        val a = schedule(weekdays, "08:00", "14:00", setOf("maps", "music"), id = "a")
        val b = schedule(weekdays, "12:00", "15:00", setOf("music", "calculator"), id = "b")
        val active = Schedules.active(listOf(a, b), at("2027-01-04T12:30:00"), cph)
        assertThat(Schedules.allowedDuringWindows(active)).containsExactly("music")
        assertThat(Schedules.allowedDuringWindows(emptyList())).isNull()
    }
}
