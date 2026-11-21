// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.content.Context
import java.time.Duration
import java.time.Instant
import org.plainphone.app.BootClock
import org.plainphone.app.light.Mode
import org.plainphone.app.sync.StatusNotices

/**
 * What time it is as far as the phone can know, for everything that decides whether something is
 * locked (docs/light-mode.md, "The phone's clock").
 *
 * The real time lies between [earliest] and [latest]. Right after a sync both are the same moment.
 * After a restart without a sync, the phone only knows a lower bound, and a schedule window that
 * could be on anywhere in the range counts as on. [wall] is the phone's own clock, only used to map
 * a moment onto timestamps Android itself takes with it (usage events).
 */
data class TrustedTime(val earliest: Instant, val latest: Instant, val wall: Instant, val source: Source) {
    enum class Source {
        /** The server's time at the last sync plus the time since then on the boot clock. */
        SERVER,
        /** Restarted since the last sync: a lower bound only, so the cautious rule applies. */
        SINCE_RESTART,
        /** The phone's own clock: strong mode (automatic time is forced) or no server time yet. */
        PHONE_CLOCK,
    }

    /** The moment to count with (day, month, recorded times): the earliest possible, so no count resets early. */
    val instant: Instant get() = earliest
    val ms: Long get() = earliest.toEpochMilli()
    val exact: Boolean get() = earliest == latest

    /** [at] on the phone's own clock, which may be set differently. */
    fun onWallClock(at: Instant): Instant = at.plusMillis(wall.toEpochMilli() - earliest.toEpochMilli())

    /**
     * How long until [next] says something changes, for both ends of the range (a window enters the
     * range at its upper end and leaves it at the lower end). Null when [next] has nothing.
     */
    fun untilNext(next: (Instant) -> Instant?): Duration? =
        listOf(earliest, latest).distinct().mapNotNull { at -> next(at)?.let { Duration.between(at, it) } }.minOrNull()

    companion object {
        /** An exact moment: tests, and callers that already know the time. */
        fun at(instant: Instant) = TrustedTime(instant, instant, instant, Source.PHONE_CLOCK)
    }
}

/**
 * Keeps the server's time across the boot clock, which the user cannot change.
 *
 * - At every sync: the server's time is stored together with the boot clock and which boot it is.
 * - In the same boot: now = that server time + the time since on the boot clock. The phone's own
 *   clock is ignored.
 * - After a restart without a sync: the last moment the phone knew (kept up to date while it ran)
 *   plus the time since the restart is a lower bound. The upper bound is the phone's clock, but at
 *   least [MAX_UNSYNCED_MS] above the lower bound, because the phone may have been off for a while
 *   and its clock may be set back. Windows that may be on in that range count as on.
 * - Before the first server time ever, and in strong mode (automatic time is forced there), the
 *   phone's clock is used.
 *
 * When the phone's clock differs from the server's time by more than [JUMP_MS], the parents are told
 * once (a status notice). That never loosens anything.
 */
class TrustedClock internal constructor(
    private val store: Store,
    private val boot: BootClock,
    private val wallMs: () -> Long,
    private val trustWall: () -> Boolean = { false },
    private val onClockMoved: () -> Unit = {},
) {
    /** At [elapsedMs] on the boot clock of boot [boot], the time was (anchor) or was at least (floor) [ms]. */
    data class Reference(val ms: Long, val elapsedMs: Long, val boot: Int)

    data class State(val anchor: Reference? = null, val floor: Reference? = null, val moveReported: Boolean = false)

    interface Store {
        fun load(): State
        fun save(state: State)
    }

    fun now(): TrustedTime = synchronized(LOCK) {
        val wall = wallMs()
        val elapsed = boot.elapsedMs()
        val bootNo = boot.boot()
        val state = store.load()
        val time = evaluate(state, elapsed, bootNo, wall)
        var next = state
        if (time.source != TrustedTime.Source.PHONE_CLOCK) {
            // Remember how far the phone got, so a restart without a sync still knows a lower bound.
            val floor = state.floor
            if (floor == null || floor.boot != bootNo || elapsed < floor.elapsedMs || elapsed - floor.elapsedMs >= FLOOR_EVERY_MS) {
                next = next.copy(floor = Reference(time.ms, elapsed, bootNo))
            }
        }
        if (time.source == TrustedTime.Source.SERVER) {
            val off = Math.abs(wall - time.ms)
            if (off > JUMP_MS && !state.moveReported) {
                runCatching(onClockMoved)
                next = next.copy(moveReported = true)
            } else if (off < SETTLED_MS && state.moveReported) {
                next = next.copy(moveReported = false)
            }
        }
        if (next != state) store.save(next)
        if (trustWall()) TrustedTime.at(Instant.ofEpochMilli(wall)) else time
    }

    /** The server said it was [serverMs] when the boot clock showed [elapsedAtMs] (this boot). */
    fun onServerTime(serverMs: Long, elapsedAtMs: Long) = synchronized(LOCK) {
        if (serverMs < SANE_AFTER_MS || elapsedAtMs < 0 || elapsedAtMs > boot.elapsedMs()) return
        val reference = Reference(serverMs, elapsedAtMs, boot.boot())
        store.save(store.load().copy(anchor = reference, floor = reference))
    }

    companion object {
        /** How long the phone may plausibly have been off before a restart. Documented in docs/light-mode.md. */
        const val MAX_UNSYNCED_MS = 12 * 3_600_000L
        /** A phone clock this far from the server's time is told to the parents. */
        const val JUMP_MS = 10 * 60_000L
        /** Back within this, a later move is told again. */
        const val SETTLED_MS = 2 * 60_000L
        private const val FLOOR_EVERY_MS = 60_000L
        /** 2020-01-01: anything earlier is not a real server time. */
        private const val SANE_AFTER_MS = 1_577_836_800_000L
        private const val PREFS = "plainphone_trusted_clock"
        private val LOCK = Any()

        /** Pure: the time for [state] at boot clock [elapsed] of boot [boot], with the phone's clock at [wall]. */
        internal fun evaluate(state: State, elapsed: Long, boot: Int, wall: Long): TrustedTime {
            val wallAt = Instant.ofEpochMilli(wall)
            val anchor = state.anchor
            if (anchor != null && sameBoot(anchor, elapsed, boot)) {
                val at = Instant.ofEpochMilli(anchor.ms + elapsed - anchor.elapsedMs)
                return TrustedTime(at, at, wallAt, TrustedTime.Source.SERVER)
            }
            val lower = listOfNotNull(anchor, state.floor).maxOfOrNull { lowerBound(it, elapsed, boot) }
                ?: return TrustedTime(wallAt, wallAt, wallAt, TrustedTime.Source.PHONE_CLOCK)
            val upper = maxOf(wall, lower + MAX_UNSYNCED_MS)
            return TrustedTime(Instant.ofEpochMilli(lower), Instant.ofEpochMilli(upper), wallAt, TrustedTime.Source.SINCE_RESTART)
        }

        private fun sameBoot(r: Reference, elapsed: Long, boot: Int) = r.boot == boot && elapsed >= r.elapsedMs

        /** In the same boot the reference moves with the boot clock; after a restart at least the uptime has passed. */
        private fun lowerBound(r: Reference, elapsed: Long, boot: Int): Long =
            if (sameBoot(r, elapsed, boot)) r.ms + elapsed - r.elapsedMs else r.ms + elapsed

        /** The phone's instance: SharedPreferences, the boot clock and the phone's clock. Cheap, so callers do not cache it. */
        fun of(context: Context): TrustedClock {
            val app = context.applicationContext
            val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val store = object : Store {
                override fun load() = State(
                    anchor = prefs.reference("anchor"),
                    floor = prefs.reference("floor"),
                    moveReported = prefs.getBoolean("move_reported", false),
                )

                override fun save(state: State) {
                    val edit = prefs.edit()
                    for ((key, r) in listOf("anchor" to state.anchor, "floor" to state.floor)) {
                        if (r == null) {
                            edit.remove("${key}_ms").remove("${key}_elapsed").remove("${key}_boot")
                        } else {
                            edit.putLong("${key}_ms", r.ms).putLong("${key}_elapsed", r.elapsedMs).putInt("${key}_boot", r.boot)
                        }
                    }
                    edit.putBoolean("move_reported", state.moveReported).apply()
                }
            }
            return TrustedClock(
                store, BootClock.of(app), System::currentTimeMillis,
                trustWall = { !Mode.isLight(app) },
                onClockMoved = { StatusNotices(app).record(StatusNotices.CLOCK_MOVED) },
            )
        }

        private fun android.content.SharedPreferences.reference(key: String): Reference? {
            if (!contains("${key}_ms")) return null
            return Reference(getLong("${key}_ms", 0L), getLong("${key}_elapsed", 0L), getInt("${key}_boot", -1))
        }
    }
}
