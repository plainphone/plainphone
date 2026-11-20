// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.plainphone.app.sync.FakeSyncApi

/** The pure rules of emergency openings. Every clock is pinned; no test reads the real date. */
class EmergencyOpeningsTest {
    private class Env(var wall: Long, var elapsed: Long = 5_000_000L, var boot: Int = 7) : EmergencyEnv {
        private var n = 0
        override fun wallMs() = wall
        override fun elapsedMs() = elapsed
        override fun bootCount() = boot
        override fun newId() = "00000000-0000-4000-8000-%012d".format(++n)

        fun advance(minutes: Long) {
            wall += minutes * 60_000L
            elapsed += minutes * 60_000L
        }
    }

    private val cph = ZoneId.of("Europe/Copenhagen")
    private val own = "org.plainphone.app"
    private val game = "com.example.game"
    private val video = "com.example.video"

    private fun at(iso: String) = Instant.parse(iso).toEpochMilli()

    private fun rules(allowance: Int = 3, usedMonth: String? = null, usedCount: Int = 0, enabled: Boolean = true) =
        EmergencyRules(enabled, allowance, 15, usedMonth, usedCount)

    private fun subject(now: String, storage: MemoryEmergencyStorage = MemoryEmergencyStorage()): Pair<EmergencyOpenings, Env> {
        val env = Env(at(now))
        return EmergencyOpenings(storage, env) to env
    }

    private fun EmergencyOpenings.open(
        rules: EmergencyRules,
        pkg: String = game,
        reason: BlockedActivity.Reason? = BlockedActivity.Reason.NOT_ALLOWED,
        self: Boolean = true,
        zone: ZoneId = cph,
    ) = start(pkg, reason, self, rules, zone, own)

    private fun EmergencyStart.refusal() = (this as EmergencyStart.Refused).why

    // --- counting ---------------------------------------------------------------------

    @Test fun `each opening uses one of the allowance`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        val r = rules(allowance = 3)
        assertEquals(3, e.remaining(r, cph))
        assertTrue(e.open(r) is EmergencyStart.Started)
        env.advance(20)
        assertTrue(e.open(r, pkg = video, reason = BlockedActivity.Reason.TIME_USED_UP) is EmergencyStart.Started)
        assertEquals(2, e.usedThisMonth(r, cph))
        assertEquals(1, e.remaining(r, cph))
    }

    @Test fun `the count is the higher of the phone's and the server's, never the sum`() {
        val (e, _) = subject("2026-06-10T10:00:00Z")
        e.open(rules(allowance = 5))
        // The server already counted that same opening: still one used, not two.
        assertEquals(1, e.usedThisMonth(rules(allowance = 5, usedMonth = "2026-06", usedCount = 1), cph))
        // The server knows more (the app data was cleared): its count wins.
        assertEquals(4, e.usedThisMonth(rules(allowance = 5, usedMonth = "2026-06", usedCount = 4), cph))
        // The server's count is for another month: it says nothing about this one.
        assertEquals(1, e.usedThisMonth(rules(allowance = 5, usedMonth = "2026-05", usedCount = 4), cph))
        assertEquals(4, e.remaining(rules(allowance = 5, usedMonth = "2026-05", usedCount = 4), cph))
    }

    @Test fun `a cleared phone starts from the server's count`() {
        val (e, _) = subject("2026-06-10T10:00:00Z")
        val r = rules(allowance = 3, usedMonth = "2026-06", usedCount = 3)
        assertEquals(0, e.remaining(r, cph))
        assertEquals(EmergencyRefusal.NONE_LEFT, e.open(r).refusal())
    }

    @Test fun `remaining never goes below zero`() {
        val (e, _) = subject("2026-06-10T10:00:00Z")
        assertEquals(0, e.remaining(rules(allowance = 2, usedMonth = "2026-06", usedCount = 9), cph))
    }

    // --- the month ---------------------------------------------------------------------

    @Test fun `the count starts again at local midnight on 31 October to 1 November in Copenhagen`() {
        // 2026-10-25 was the DST fall-back: Copenhagen is UTC+1 on 31 October.
        val (e, env) = subject("2026-10-31T22:00:00Z") // 23:00 local, still October
        val r = rules(allowance = 1)
        assertTrue(e.open(r) is EmergencyStart.Started)
        env.wall = at("2026-10-31T22:59:59Z") // 23:59:59 local
        assertEquals(0, e.remaining(r, cph))
        env.wall = at("2026-10-31T23:00:00Z") // 00:00 local on 1 November
        assertEquals(1, e.remaining(r, cph))
        // A server count for October says nothing about November.
        assertEquals(1, e.remaining(rules(allowance = 1, usedMonth = "2026-10", usedCount = 1), cph))
    }

    @Test fun `the month boundary follows the clock change on 25 October 2026`() {
        val (e, _) = subject("2026-10-25T00:30:00Z")
        // 02:30 CEST becomes 02:30 CET an hour later: both are October.
        assertEquals("2026-10", e.monthKey(at("2026-10-25T00:30:00Z"), cph))
        assertEquals("2026-10", e.monthKey(at("2026-10-25T01:30:00Z"), cph))
        // 1 October 00:00 CEST is 30 September 22:00 UTC.
        assertEquals("2026-09", e.monthKey(at("2026-09-30T21:59:59Z"), cph))
        assertEquals("2026-10", e.monthKey(at("2026-09-30T22:00:00Z"), cph))
    }

    @Test fun `the month boundary follows the spring clock change on 29 March 2026`() {
        val (e, _) = subject("2026-03-29T00:30:00Z")
        assertEquals("2026-03", e.monthKey(at("2026-03-29T00:30:00Z"), cph)) // 01:30 CET
        assertEquals("2026-03", e.monthKey(at("2026-03-29T01:30:00Z"), cph)) // 03:30 CEST
        // 1 March 00:00 CET is 28 February 23:00 UTC; 1 April 00:00 CEST is 31 March 22:00 UTC.
        assertEquals("2026-02", e.monthKey(at("2026-02-28T22:59:59Z"), cph))
        assertEquals("2026-03", e.monthKey(at("2026-02-28T23:00:00Z"), cph))
        assertEquals("2026-03", e.monthKey(at("2026-03-31T21:59:59Z"), cph))
        assertEquals("2026-04", e.monthKey(at("2026-03-31T22:00:00Z"), cph))
    }

    @Test fun `a zone ahead of UTC changes month before UTC does`() {
        val (e, _) = subject("2026-10-31T10:00:00Z")
        val nz = ZoneId.of("Pacific/Auckland") // UTC+13 in October (summer time)
        assertEquals("2026-10", e.monthKey(at("2026-10-31T10:59:59Z"), nz))
        assertEquals("2026-11", e.monthKey(at("2026-10-31T11:00:00Z"), nz))
        assertEquals("2026-10", e.monthKey(at("2026-10-31T11:00:00Z"), ZoneId.of("UTC")))
    }

    @Test fun `a zone behind UTC changes month after UTC does`() {
        val (e, _) = subject("2026-11-01T06:00:00Z")
        val la = ZoneId.of("America/Los_Angeles") // UTC-7 until 1 November 09:00 UTC
        assertEquals("2026-10", e.monthKey(at("2026-11-01T06:59:59Z"), la))
        assertEquals("2026-11", e.monthKey(at("2026-11-01T07:00:00Z"), la))
        assertEquals("2026-11", e.monthKey(at("2026-11-01T06:59:59Z"), ZoneId.of("UTC")))
    }

    @Test fun `the month is the phone's zone, not the zone the opening was made in`() {
        val (e, env) = subject("2026-11-01T06:30:00Z") // still 31 October in Los Angeles
        val la = ZoneId.of("America/Los_Angeles")
        val r = rules(allowance = 1)
        assertTrue(e.open(r, zone = la) is EmergencyStart.Started)
        env.wall = at("2026-11-01T06:59:00Z")
        assertEquals(0, e.remaining(r, la))
        env.wall = at("2026-11-01T07:00:00Z")
        assertEquals(1, e.remaining(r, la))
    }

    // --- the window --------------------------------------------------------------------

    @Test fun `the window covers one app for fifteen minutes`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        assertTrue(e.open(rules()) is EmergencyStart.Started)
        assertTrue(e.isActive(game))
        assertFalse("only the one app", e.isActive(video))
        env.advance(14)
        env.wall += 59_000; env.elapsed += 59_000
        assertTrue(e.isActive(game))
        assertEquals(1_000L, e.activeLeftMs())
        env.wall += 1_000; env.elapsed += 1_000
        assertFalse(e.isActive(game))
        assertNull(e.activeLeftMs())
    }

    @Test fun `a reboot ends the window`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        e.open(rules())
        env.elapsed = 30_000L // elapsedRealtime starts again after a reboot
        env.wall += 2 * 60_000L
        assertFalse(e.isActive(game))
    }

    @Test fun `a different boot ends the window even if the clock is already higher`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        e.open(rules())
        env.boot = 8
        env.elapsed += 60_000L
        env.wall += 60_000L
        assertFalse(e.isActive(game))
    }

    @Test fun `setting the wall clock forward ends the window`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        e.open(rules())
        env.elapsed += 60_000L
        env.wall += 16 * 60_000L
        assertFalse(e.isActive(game))
    }

    @Test fun `setting the wall clock back does not stretch the window`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        e.open(rules())
        env.elapsed += 16 * 60_000L
        env.wall -= 3_600_000L
        assertFalse(e.isActive(game))
    }

    // --- refusals ----------------------------------------------------------------------

    @Test fun `switched off or not a Self phone offers and allows nothing`() {
        val (e, _) = subject("2026-06-10T10:00:00Z")
        assertEquals(EmergencyRefusal.OFF, e.open(rules(enabled = false)).refusal())
        assertEquals(EmergencyRefusal.OFF, e.open(EmergencyRules.OFF).refusal())
        assertEquals(EmergencyRefusal.OFF, e.open(rules(), self = false).refusal())
        assertNull(e.offer(BlockedActivity.Reason.NOT_ALLOWED, true, rules(enabled = false), cph))
        assertNull(e.offer(BlockedActivity.Reason.NOT_ALLOWED, false, rules(), cph))
        assertTrue(e.openings().isEmpty())
        assertFalse(e.isActive(game))
    }

    @Test fun `only an allow-list block or a used-up limit can be opened`() {
        val (e, _) = subject("2026-06-10T10:00:00Z")
        val r = rules()
        assertEquals(EmergencyRefusal.NOT_BLOCKED, e.open(r, reason = null).refusal())
        assertEquals(EmergencyRefusal.NOT_BLOCKED, e.open(r, reason = BlockedActivity.Reason.PROTECTION).refusal())
        assertEquals(EmergencyRefusal.NOT_BLOCKED, e.open(r, reason = BlockedActivity.Reason.OTHER).refusal())
        assertEquals(EmergencyRefusal.NOT_BLOCKED, e.open(r, pkg = own).refusal())
        assertEquals(EmergencyRefusal.NOT_BLOCKED, e.open(r, pkg = "").refusal())
        assertNull(e.offer(BlockedActivity.Reason.PROTECTION, true, r, cph))
        assertEquals(3, e.offer(BlockedActivity.Reason.TIME_USED_UP, true, r, cph))
        assertTrue(e.openings().isEmpty())
    }

    @Test fun `with none left there is nothing to start, and the offer says zero`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        val r = rules(allowance = 1)
        e.open(r)
        env.advance(20)
        assertEquals(EmergencyRefusal.NONE_LEFT, e.open(r, pkg = video).refusal())
        assertEquals(0, e.offer(BlockedActivity.Reason.NOT_ALLOWED, true, r, cph))
        assertEquals(1, e.openings().size)
    }

    @Test fun `one opening at a time, and the next can start when the first has ended`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        val r = rules()
        assertTrue(e.open(r) is EmergencyStart.Started)
        env.advance(5)
        assertEquals(EmergencyRefusal.BUSY, e.open(r, pkg = video).refusal())
        assertEquals(EmergencyRefusal.BUSY, e.open(r, pkg = game).refusal())
        assertEquals(1, e.openings().size)
        env.advance(11)
        assertTrue(e.open(r, pkg = video) is EmergencyStart.Started)
        assertTrue(e.isActive(video))
        assertFalse(e.isActive(game))
    }

    @Test fun `clearing forgets only a window that is over`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        e.open(rules())
        e.clearIfOver()
        assertTrue(e.hasActiveRecord(game))
        env.advance(16)
        e.clearIfOver()
        assertFalse(e.hasActiveRecord(game))
    }

    // --- the queue and the report --------------------------------------------------------

    @Test fun `an opening is recorded before anything is reported, and works offline`() {
        val storage = MemoryEmergencyStorage()
        val (e, _) = subject("2026-06-10T10:00:00Z", storage)
        val started = e.open(rules()) as EmergencyStart.Started
        assertFalse(started.opening.reported)
        // A new instance over the same storage (the app was restarted) still has it queued.
        val again = EmergencyOpenings(storage, Env(at("2026-06-10T10:01:00Z")))
        assertEquals(listOf(started.opening.id), again.pending().map { it.id })
        assertEquals(game, again.pending().single().packageName)
        assertEquals(15, again.pending().single().minutes)
        assertEquals(at("2026-06-10T10:00:00Z"), again.pending().single().openedAtMs)
    }

    @Test fun `queued openings are reported once each, oldest first, and then forgotten`() {
        val (e, env) = subject("2026-06-10T10:00:00Z")
        val r = rules()
        e.open(r)
        env.advance(20)
        e.open(r, pkg = video)
        val api = FakeSyncApi()
        EmergencyOpenings.reportPending(e, api, "token")
        assertEquals(listOf(game, video), api.emergencyReports.map { it.packageName })
        assertTrue(e.pending().isEmpty())
        EmergencyOpenings.reportPending(e, api, "token")
        assertEquals("nothing is sent twice", 2, api.emergencyReports.size)
        // Reported openings still count toward the month.
        assertEquals(2, e.usedThisMonth(r, cph))
    }

    @Test fun `a failed report keeps the opening queued with the same id`() {
        val (e, _) = subject("2026-06-10T10:00:00Z")
        val started = e.open(rules()) as EmergencyStart.Started
        val api = FakeSyncApi()
        api.emergencyFailure = IOException("offline")
        try {
            EmergencyOpenings.reportPending(e, api, "token")
            throw AssertionError("expected the failure to reach the caller, which keeps the sync going")
        } catch (_: IOException) {
        }
        assertEquals(listOf(started.opening.id), e.pending().map { it.id })
        api.emergencyFailure = null
        EmergencyOpenings.reportPending(e, api, "token")
        assertEquals(listOf(started.opening.id), api.emergencyReports.map { it.id })
        assertTrue(e.pending().isEmpty())
    }

    @Test fun `a report the server calls malformed is dropped, not retried for ever`() {
        val (e, _) = subject("2026-06-10T10:00:00Z")
        e.open(rules())
        val api = FakeSyncApi().apply { emergencyAccepted = false }
        EmergencyOpenings.reportPending(e, api, "token")
        assertTrue(e.pending().isEmpty())
    }

    @Test fun `ninety days are kept and older reported openings are pruned`() {
        val storage = MemoryEmergencyStorage()
        val (e, env) = subject("2026-01-01T10:00:00Z", storage)
        val r = rules(allowance = 10)
        e.open(r) // 1 January
        env.advance(20)
        e.open(r, pkg = video) // also 1 January
        val oldIds = e.openings().map { it.id }
        e.markReported(oldIds[0]) // one reported, one still waiting
        env.wall = at("2026-01-01T10:00:00Z") + 91L * 24 * 60 * 60 * 1000
        env.elapsed += 91L * 24 * 60 * 60 * 1000
        e.open(r, pkg = game)
        val ids = e.openings().map { it.id }
        assertFalse("the reported old one is pruned", oldIds[0] in ids)
        assertTrue("an unreported one is never dropped before it is reported", oldIds[1] in ids)
        assertEquals(2, ids.size)
    }
}
