// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.plainphone.app.time.TrustedTime

/**
 * School time and bedtime, evaluated in wall-clock time of the phone's time zone.
 *
 * Wall-clock means daylight saving time needs no special case: a bedtime from 21:00 to
 * 07:00 starts at 21:00 and ends at 07:00 local time also on the night the clocks change.
 * A window that starts inside the hour skipped in spring (02:30) starts when the clocks
 * jump (03:00). Pure logic, unit-tested on the JVM.
 */
object Schedules {

    /** The windows that apply at [now]. */
    fun active(schedules: List<Schedule>, now: Instant, zone: ZoneId): List<Schedule> {
        val local = ZonedDateTime.ofInstant(now, zone)
        val today = local.dayOfWeek.value
        val yesterday = local.minusDays(1).dayOfWeek.value
        val time = local.toLocalTime()
        return schedules.filter { s ->
            if (s.start < s.end) {
                today in s.days && time >= s.start && time < s.end
            } else {
                // Crosses midnight: the evening part belongs to today's start day,
                // the morning part to yesterday's.
                (today in s.days && time >= s.start) || (yesterday in s.days && time < s.end)
            }
        }
    }

    /**
     * The windows that may apply at [time]. With an exact time that is [active]. After a restart
     * without a sync the phone only knows a range, and a window that is on anywhere in it counts
     * ("cautious": docs/light-mode.md, "The phone's clock").
     */
    fun active(schedules: List<Schedule>, time: TrustedTime, zone: ZoneId): List<Schedule> {
        if (time.exact) return active(schedules, time.earliest, zone)
        val on = active(schedules, time.earliest, zone)
        return schedules.filter { s -> s in on || nextStart(s, time.earliest, zone)?.let { !it.isAfter(time.latest) } == true }
    }

    /** The first start of [s] after [after], or null when it has no days. */
    private fun nextStart(s: Schedule, after: Instant, zone: ZoneId): Instant? {
        val first = after.atZone(zone).toLocalDate()
        for (offset in 0L..7L) {
            val date = first.plusDays(offset)
            if (date.dayOfWeek.value !in s.days) continue
            val at = wallClock(date, s.start, zone)
            if (at.isAfter(after)) return at
        }
        return null
    }

    /**
     * Apps that may stay visible while [active] windows apply: only those every active
     * window allows (overlapping windows never loosen each other). Null when no window applies.
     */
    fun allowedDuringWindows(active: List<Schedule>): Set<String>? {
        if (active.isEmpty()) return null
        return active.map { it.allowedPackages }.reduce { a, b -> a intersect b }
    }

    /**
     * The next moment after [now] at which a window starts or ends, so the phone can
     * re-apply its rules then. Null when there are no schedules.
     */
    fun nextBoundary(schedules: List<Schedule>, now: Instant, zone: ZoneId): Instant? {
        if (schedules.isEmpty()) return null
        val startDate = now.atZone(zone).toLocalDate().minusDays(1)
        var best: Instant? = null
        for (offset in 0L..8L) {
            val date = startDate.plusDays(offset)
            for (s in schedules) {
                if (date.dayOfWeek.value !in s.days) continue
                // Ends that fall on the next day belong to a start on this date.
                val endDate = if (s.start < s.end) date else date.plusDays(1)
                for (at in listOf(wallClock(date, s.start, zone), wallClock(endDate, s.end, zone))) {
                    if (at.isAfter(now) && (best == null || at.isBefore(best))) best = at
                }
            }
        }
        return best
    }

    /**
     * The first instant at which the wall clock shows [time] or later on [date]. For a time in the
     * hour skipped in spring that is the moment the clocks jump, matching [active].
     */
    private fun wallClock(date: LocalDate, time: LocalTime, zone: ZoneId): Instant {
        val local = LocalDateTime.of(date, time)
        if (zone.rules.getValidOffsets(local).isEmpty()) return zone.rules.getTransition(local).instant
        return ZonedDateTime.of(local, zone).toInstant()
    }
}
