// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import com.google.common.truth.Truth.assertThat
import java.time.Duration
import java.time.Instant
import java.time.LocalDateTime
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.util.TimeZone
import org.junit.Test
import org.plainphone.app.BootClock
import org.plainphone.app.PolicyConfig
import org.plainphone.app.sync.EffectivePolicy
import org.plainphone.app.sync.Schedule
import org.plainphone.app.sync.Schedules
import org.plainphone.app.sync.ServerRules

/**
 * The trusted clock against a child who moves the phone's clock (docs/light-mode.md, "The phone's
 * clock"). Every fixture puts the phone's clock somewhere the windows disagree with the real time,
 * and checks both: the wall clock alone would give the other answer, so the tests fail if
 * enforcement goes back to it.
 */
class TrustedClockTest {
    private val cph = ZoneId.of("Europe/Copenhagen")
    // 2027-01-04 is a Monday.
    private val bedtime = Schedule("b", "bedtime", (1..7).toSet(), LocalTime.of(21, 0), LocalTime.of(7, 0), setOf("com.spotify.music"))
    private val school = Schedule("s", "school", (1..5).toSet(), LocalTime.of(8, 0), LocalTime.of(14, 0), setOf("com.google.android.apps.maps"))

    private fun rules(zone: ZoneId = cph) = ServerRules(
        phoneId = "p", profile = "child", timezone = zone,
        allowedApps = setOf("com.spotify.music", "com.google.android.apps.maps", "com.example.game"),
        hiddenApps = emptySet(), contacts = emptyList(), schedules = listOf(bedtime, school),
        dnsHost = null, dnsReady = false, locationEnabled = false, locationIntervalMinutes = 5,
        locateRequestedAt = null, pollSeconds = 60,
    )

    private fun local(text: String, zone: ZoneId = cph): Instant = ZonedDateTime.of(LocalDateTime.parse(text), zone).toInstant()

    private class FakeBoot(var elapsed: Long, var boot: Int) : BootClock {
        override fun elapsedMs() = elapsed
        override fun boot() = boot
    }

    private class MemoryStore : TrustedClock.Store {
        var state = TrustedClock.State()
        override fun load() = state
        override fun save(state: TrustedClock.State) { this.state = state }
    }

    private val store = MemoryStore()
    private val boot = FakeBoot(elapsed = 5_000_000L, boot = 7)
    private var wall = 0L
    private var moves = 0
    private var strong = false
    private val clock = TrustedClock(store, boot, { wall }, trustWall = { strong }, onClockMoved = { moves++ })

    /** The server says it is [at] now, and the phone's clock agrees. */
    private fun sync(at: Instant) {
        wall = at.toEpochMilli()
        clock.onServerTime(at.toEpochMilli(), boot.elapsed)
    }

    private fun pass(d: Duration) { boot.elapsed += d.toMillis() }

    private fun setWall(text: String) { wall = local(text).toEpochMilli() }

    private fun restart(upFor: Duration) {
        boot.boot += 1
        boot.elapsed = upFor.toMillis()
    }

    private fun windows(time: TrustedTime, r: ServerRules = rules()) = Schedules.active(r.schedules, time, r.timezone).map { it.kind }

    private fun windowsOnWall(r: ServerRules = rules()) = Schedules.active(r.schedules, Instant.ofEpochMilli(wall), r.timezone).map { it.kind }

    @Test
    fun `setting the clock forward in the same boot does not end bedtime`() {
        sync(local("2027-01-04T21:30"))
        pass(Duration.ofMinutes(10))
        setWall("2027-01-05T07:05")
        val time = clock.now()
        assertThat(time.source).isEqualTo(TrustedTime.Source.SERVER)
        assertThat(time.instant).isEqualTo(local("2027-01-04T21:40"))
        val merged = EffectivePolicy.merge(PolicyConfig(), rules(), time.instant, time = time)
        assertThat(merged.server!!.windowActive).isTrue()
        assertThat(merged.allowedPackages).containsExactly("com.spotify.music")
        // The phone's clock alone would have opened the apps again.
        assertThat(windowsOnWall()).isEmpty()
    }

    @Test
    fun `setting the clock back in the same boot does not end school time`() {
        sync(local("2027-01-04T09:00"))
        pass(Duration.ofMinutes(20))
        setWall("2027-01-03T16:00")
        assertThat(windows(clock.now())).containsExactly("school")
        assertThat(windowsOnWall()).isEmpty()
    }

    @Test
    fun `after a restart without a sync a window that may be on counts as on, whichever way the clock moved`() {
        sync(local("2027-01-04T20:00"))
        pass(Duration.ofMinutes(30))
        clock.now() // the phone keeps track of how far it got
        restart(upFor = Duration.ofMinutes(1))

        setWall("2027-01-04T19:00") // set back, before bedtime
        val back = clock.now()
        assertThat(back.source).isEqualTo(TrustedTime.Source.SINCE_RESTART)
        assertThat(back.earliest).isEqualTo(local("2027-01-04T20:31"))
        assertThat(back.latest).isEqualTo(local("2027-01-05T08:31"))
        assertThat(windows(back)).contains("bedtime")
        assertThat(windowsOnWall()).isEmpty()

        setWall("2027-01-05T07:30") // set forward, after bedtime
        assertThat(windows(clock.now())).contains("bedtime")
        assertThat(windowsOnWall()).isEmpty()
    }

    @Test
    fun `the cautious rule narrows apps to what every possible window allows`() {
        sync(local("2027-01-04T20:00"))
        restart(upFor = Duration.ofMinutes(1))
        setWall("2027-01-04T20:05")
        val time = clock.now()
        // 20:01 to 08:01 next morning: bedtime, and Tuesday's school time from 08:00.
        assertThat(windows(time)).containsExactly("bedtime", "school")
        val merged = EffectivePolicy.merge(PolicyConfig(), rules(), time.instant, time = time)
        assertThat(merged.allowedPackages).isEmpty()
        assertThat(EffectivePolicy.merge(PolicyConfig(), rules(), Instant.ofEpochMilli(wall)).allowedPackages)
            .containsExactly("com.spotify.music", "com.google.android.apps.maps", "com.example.game")
    }

    @Test
    fun `a sync after the restart brings the exact time back`() {
        sync(local("2027-01-04T20:00"))
        restart(upFor = Duration.ofMinutes(1))
        setWall("2027-01-04T19:00")
        assertThat(windows(clock.now())).contains("bedtime")
        // The phone was off overnight; the server knows it is Tuesday 10:30. The phone's clock stays wrong.
        clock.onServerTime(local("2027-01-05T10:30").toEpochMilli(), boot.elapsed)
        val time = clock.now()
        assertThat(time.source).isEqualTo(TrustedTime.Source.SERVER)
        assertThat(time.exact).isTrue()
        assertThat(windows(time)).containsExactly("school")
        assertThat(windowsOnWall()).isEmpty()
    }

    @Test
    fun `daylight saving time follows the real time, not the phone's clock`() {
        // Spring forward in Copenhagen: 2027-03-28 02:00 becomes 03:00.
        sync(local("2027-03-27T20:00"))
        pass(Duration.ofHours(10).minusMinutes(1))
        setWall("2027-03-28T08:30")
        assertThat(clock.now().instant).isEqualTo(local("2027-03-28T06:59"))
        assertThat(windows(clock.now())).containsExactly("bedtime")
        assertThat(windowsOnWall()).isEmpty()
        pass(Duration.ofMinutes(1))
        setWall("2027-03-28T06:30")
        assertThat(windows(clock.now())).isEmpty()
        assertThat(windowsOnWall()).containsExactly("bedtime")
    }

    @Test
    fun `changing the phone's time zone changes nothing, the rules' zone decides`() {
        sync(local("2027-01-04T22:00"))
        val saved = TimeZone.getDefault()
        try {
            // Auckland is Tuesday 10:00, school time there; the rules say Copenhagen, where it is bedtime.
            TimeZone.setDefault(TimeZone.getTimeZone("Pacific/Auckland"))
            assertThat(windows(clock.now())).containsExactly("bedtime")
        } finally {
            TimeZone.setDefault(saved)
        }
        // A new zone in the rules (the family moved) moves the windows with it: 22:00 here is 16:00 there.
        assertThat(windows(clock.now(), rules(ZoneId.of("America/New_York")))).isEmpty()
    }

    @Test
    fun `a long time offline in the same boot keeps counting from the server's time`() {
        sync(local("2027-01-08T16:00")) // Friday
        pass(Duration.ofDays(2).plusHours(17)) // Monday 09:00
        setWall("2027-01-09T16:00") // Saturday afternoon
        val time = clock.now()
        assertThat(time.exact).isTrue()
        assertThat(time.instant).isEqualTo(local("2027-01-11T09:00"))
        assertThat(windows(time)).containsExactly("school")
        assertThat(windowsOnWall()).isEmpty()
    }

    @Test
    fun `a long time off before a restart counts every window up to the phone's clock`() {
        sync(local("2027-01-08T16:00")) // Friday
        restart(upFor = Duration.ofMinutes(1))
        setWall("2027-01-11T09:00") // Monday, the real time
        assertThat(windows(clock.now())).containsExactly("bedtime", "school")
        // With the phone's clock still on Friday, the range is the 12 plausible hours: Friday night's bedtime only.
        setWall("2027-01-08T16:30")
        assertThat(windows(clock.now())).containsExactly("bedtime")
    }

    @Test
    fun `the lower bound survives several restarts without a sync`() {
        sync(local("2027-01-04T10:00"))
        pass(Duration.ofHours(2))
        clock.now()
        restart(upFor = Duration.ofHours(3))
        assertThat(clock.now().earliest).isEqualTo(local("2027-01-04T15:00"))
        restart(upFor = Duration.ofMinutes(1))
        assertThat(clock.now().earliest).isEqualTo(local("2027-01-04T15:01"))
    }

    @Test
    fun `a moved clock is told to the parents once per move`() {
        sync(local("2027-01-04T12:00"))
        wall += Duration.ofMinutes(5).toMillis()
        clock.now()
        assertThat(moves).isEqualTo(0)
        wall += Duration.ofMinutes(25).toMillis()
        repeat(3) { clock.now() }
        assertThat(moves).isEqualTo(1)
        // Back to the right time re-arms it; the next move is told again.
        wall = clock.now().ms + 30_000L
        clock.now()
        wall -= Duration.ofHours(2).toMillis()
        clock.now()
        assertThat(moves).isEqualTo(2)
    }

    @Test
    fun `without any server time, and in strong mode, the phone's clock is used`() {
        setWall("2027-01-04T22:00")
        val first = clock.now()
        assertThat(first.source).isEqualTo(TrustedTime.Source.PHONE_CLOCK)
        assertThat(first.instant).isEqualTo(local("2027-01-04T22:00"))

        sync(local("2027-01-04T12:00"))
        setWall("2027-01-04T22:00")
        strong = true // Device Owner forces automatic time
        assertThat(clock.now().instant).isEqualTo(local("2027-01-04T22:00"))
        strong = false
        assertThat(clock.now().instant).isEqualTo(local("2027-01-04T12:00"))
    }

    @Test
    fun `ignores server times that cannot be real`() {
        sync(local("2027-01-04T12:00"))
        clock.onServerTime(0L, boot.elapsed)
        clock.onServerTime(local("2027-01-05T12:00").toEpochMilli(), boot.elapsed + 1)
        assertThat(clock.now().instant).isEqualTo(local("2027-01-04T12:00"))
    }

    @Test
    fun `the next change is the nearer of the range's two ends`() {
        val time = TrustedTime(local("2027-01-04T20:00"), local("2027-01-05T07:50"), local("2027-01-04T20:00"), TrustedTime.Source.SINCE_RESTART)
        // From 20:00 bedtime starts in 1 h; from 07:50 school starts in 10 min (and is already counted).
        val next = time.untilNext { Schedules.nextBoundary(rules().schedules, it, cph) }
        assertThat(next).isEqualTo(Duration.ofMinutes(10))
    }
}
