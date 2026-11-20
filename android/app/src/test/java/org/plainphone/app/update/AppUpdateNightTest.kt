// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import org.junit.Test

/** When the nightly window may open. Every instant is fixed; nothing reads today's date. */
class AppUpdateNightTest {
    private val cph = ZoneId.of("Europe/Copenhagen")
    private val ok = AppUpdateNight.Conditions(enabled = true, strong = true, charging = true, unmetered = true)

    private fun at(text: String, zone: ZoneId = cph) = LocalDateTime.parse(text).atZone(zone).toInstant()

    @Test fun `opens between two and five local time`() {
        assertThat(AppUpdateNight.due(at("2026-06-10T01:59"), cph, null, ok)).isNull()
        assertThat(AppUpdateNight.due(at("2026-06-10T02:00"), cph, null, ok)).isEqualTo(LocalDate.parse("2026-06-10"))
        assertThat(AppUpdateNight.due(at("2026-06-10T04:59"), cph, null, ok)).isEqualTo(LocalDate.parse("2026-06-10"))
        assertThat(AppUpdateNight.due(at("2026-06-10T05:00"), cph, null, ok)).isNull()
        assertThat(AppUpdateNight.due(at("2026-06-10T14:00"), cph, null, ok)).isNull()
    }

    @Test fun `once a night`() {
        val night = LocalDate.parse("2026-06-10")
        assertThat(AppUpdateNight.due(at("2026-06-10T03:30"), cph, night, ok)).isNull()
        assertThat(AppUpdateNight.due(at("2026-06-11T02:10"), cph, night, ok)).isEqualTo(LocalDate.parse("2026-06-11"))
    }

    @Test fun `only while charging on an unmetered network, in strong mode, with the toggle on`() {
        val t = at("2026-06-10T03:00")
        assertThat(AppUpdateNight.due(t, cph, null, ok.copy(charging = false))).isNull()
        assertThat(AppUpdateNight.due(t, cph, null, ok.copy(unmetered = false))).isNull()
        assertThat(AppUpdateNight.due(t, cph, null, ok.copy(strong = false))).isNull()
        assertThat(AppUpdateNight.due(t, cph, null, ok.copy(enabled = false))).isNull()
        assertThat(AppUpdateNight.due(t, cph, null, ok)).isNotNull()
    }

    @Test fun `the night the clocks go forward has shorter hours but still opens`() {
        // 2026-03-29: 02:00 CET jumps to 03:00 CEST. 01:30 UTC is 03:30 local.
        val jump = LocalDateTime.parse("2026-03-29T01:30").toInstant(ZoneOffset.UTC)
        assertThat(AppUpdateNight.due(jump, cph, LocalDate.parse("2026-03-28"), ok)).isEqualTo(LocalDate.parse("2026-03-29"))
        // 00:59 UTC is 01:59 CET, just before the jump.
        val before = LocalDateTime.parse("2026-03-29T00:59").toInstant(ZoneOffset.UTC)
        assertThat(AppUpdateNight.due(before, cph, null, ok)).isNull()
    }

    @Test fun `the night the clocks go back opens once, not twice`() {
        // 2026-10-25: 03:00 CEST goes back to 02:00 CET, so 02:30 happens at 00:30 and 01:30 UTC.
        val first = LocalDateTime.parse("2026-10-25T00:30").toInstant(ZoneOffset.UTC)
        val second = LocalDateTime.parse("2026-10-25T01:30").toInstant(ZoneOffset.UTC)
        val night = AppUpdateNight.due(first, cph, LocalDate.parse("2026-10-24"), ok)
        assertThat(night).isEqualTo(LocalDate.parse("2026-10-25"))
        assertThat(AppUpdateNight.due(second, cph, night, ok)).isNull()
    }

    @Test fun `local time follows the phone's zone`() {
        val t = at("2026-06-10T03:00", ZoneId.of("America/New_York"))
        assertThat(AppUpdateNight.due(t, cph, null, ok)).isNull()
        assertThat(AppUpdateNight.due(t, ZoneId.of("America/New_York"), null, ok)).isNotNull()
    }
}
