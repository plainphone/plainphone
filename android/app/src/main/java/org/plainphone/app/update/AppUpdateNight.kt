// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId

/**
 * When the nightly app update window may open: once a night between [START] and [END] local
 * time, while the phone charges on Wi-Fi (or another unmetered network). Pure, so it is
 * unit-tested on the JVM with fixed instants, including the nights the clocks change.
 */
object AppUpdateNight {
    val START: LocalTime = LocalTime.of(2, 0)
    val END: LocalTime = LocalTime.of(5, 0)

    /**
     * The night [now] belongs to (the local date of its start), or null outside the hours.
     * On the night the clocks go forward 02:00 to 03:00 does not exist, so the hours are shorter;
     * on the night they go back 02:00 to 03:00 happens twice, but it is still one night.
     */
    fun night(now: Instant, zone: ZoneId): LocalDate? {
        val local = now.atZone(zone)
        val time = local.toLocalTime()
        return local.toLocalDate().takeIf { !time.isBefore(START) && time.isBefore(END) }
    }

    data class Conditions(
        /** The parent's toggle "Update approved apps automatically". */
        val enabled: Boolean,
        /** Only strong mode blocks installs; light mode never needs a window. */
        val strong: Boolean,
        val charging: Boolean,
        val unmetered: Boolean,
    )

    /** The night to open the window for now, or null when it should stay closed. */
    fun due(now: Instant, zone: ZoneId, lastNight: LocalDate?, conditions: Conditions): LocalDate? {
        if (!conditions.enabled || !conditions.strong || !conditions.charging || !conditions.unmetered) return null
        val night = night(now, zone) ?: return null
        return night.takeIf { lastNight == null || it.isAfter(lastNight) }
    }
}
