// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject

/**
 * Daily minutes per app and in total (`timeLimits` in the rules, docs/time-limits.md).
 * Pure logic, unit-tested on the JVM. The phone counts and evaluates offline: the server
 * only sends the limits.
 */
data class TimeLimits(
    /** Cap for all non-core apps together, or null. */
    val total: Limit?,
    val apps: Map<String, Limit>,
    val bonuses: List<Bonus>,
) {
    /** Minutes for one ISO weekday; [days] overrides [minutes] on the days it lists. */
    data class Limit(val minutes: Int, val days: Map<Int, Int> = emptyMap()) {
        fun minutesOn(date: LocalDate): Int = days[date.dayOfWeek.value] ?: minutes
    }

    /** Extra minutes on one local date. [packageName] is [TOTAL] for the total cap. */
    data class Bonus(val packageName: String, val date: LocalDate, val minutes: Int)

    val isEmpty: Boolean get() = total == null && apps.isEmpty()

    /** The cap in minutes on [date] for [packageName] ([TOTAL] = the total), bonuses included; null = no cap. */
    fun capMinutes(packageName: String, date: LocalDate): Int? {
        val base = (if (packageName == TOTAL) total else apps[packageName])?.minutesOn(date) ?: return null
        val extra = bonuses.filter { it.packageName == packageName && it.date == date }.sumOf { it.minutes }
        return (base + extra).coerceIn(0, 24 * 60)
    }

    /**
     * What is used up today.
     *
     * @param usedMs foreground time today per package
     * @param exempt core apps (phone, messages, maps, clock, Settings, launcher, keyboard, Plainphone):
     *   they never count towards the total and are never blocked
     */
    fun evaluate(usedMs: Map<String, Long>, date: LocalDate, exempt: Set<String>): Evaluation {
        val counted = usedMs.filterKeys { it !in exempt }
        val totalUsed = counted.values.sum()
        val totalCap = capMinutes(TOTAL, date)?.let { it * MINUTE }
        val perApp = apps.keys.filter { it !in exempt }.associateWith { pkg ->
            val cap = capMinutes(pkg, date)!! * MINUTE
            (cap - (counted[pkg] ?: 0L)).coerceAtLeast(0L)
        }
        return Evaluation(
            totalRemainingMs = totalCap?.let { (it - totalUsed).coerceAtLeast(0L) },
            appRemainingMs = perApp,
            totalUsedMs = totalUsed,
            usedMs = counted,
        )
    }

    data class Evaluation(
        /** Null when there is no total cap. */
        val totalRemainingMs: Long?,
        /** Remaining time for each app with its own cap. */
        val appRemainingMs: Map<String, Long>,
        val totalUsedMs: Long,
        val usedMs: Map<String, Long>,
    ) {
        val totalUsedUp: Boolean get() = totalRemainingMs == 0L

        /** Whether [pkg] is blocked for the rest of the day. Core apps are never passed in here. */
        fun isUsedUp(pkg: String): Boolean = totalUsedUp || appRemainingMs[pkg] == 0L

        /** Time left for [pkg] today: the smaller of its own cap and the total. Null = no cap applies. */
        fun remainingFor(pkg: String): Long? =
            listOfNotNull(totalRemainingMs, appRemainingMs[pkg]).minOrNull()

        /** Packages with their own cap that are used up (the total is handled by [totalUsedUp]). */
        val usedUpApps: Set<String> get() = appRemainingMs.filterValues { it == 0L }.keys

        /** For the parent's dashboard: whole minutes used today, "*" = total. */
        fun usedMinutes(limited: Set<String>): Map<String, Int> = buildMap {
            put(TOTAL, (totalUsedMs / MINUTE).toInt().coerceIn(0, 1440))
            for (pkg in limited) put(pkg, ((usedMs[pkg] ?: 0L) / MINUTE).toInt().coerceIn(0, 1440))
        }
    }

    companion object {
        const val TOTAL = "*"
        private const val MINUTE = 60_000L
        val NONE = TimeLimits(null, emptyMap(), emptyList())

        /** Throws on anything malformed, like the rest of [ServerRules.parse]. */
        fun parse(j: JSONObject): TimeLimits {
            fun limit(o: JSONObject): Limit {
                val minutes = o.getInt("minutes")
                require(minutes in 0..1440) { "bad minutes $minutes" }
                val days = o.optJSONObject("days")?.let { d ->
                    d.keys().asSequence().associate { k ->
                        val day = k.toInt()
                        val m = d.getInt(k)
                        require(day in 1..7 && m in 0..1440) { "bad day limit $k=$m" }
                        day to m
                    }
                }.orEmpty()
                return Limit(minutes, days)
            }
            val total = j.optJSONObject("total")?.let(::limit)
            val apps = j.optJSONArray("apps")?.let(ServerRules::objects).orEmpty()
                .associate { it.getString("packageName") to limit(it) }
            val bonuses = j.optJSONArray("bonuses")?.let(ServerRules::objects).orEmpty().map {
                Bonus(it.getString("packageName"), LocalDate.parse(it.getString("date")), it.getInt("minutes").coerceIn(0, 1440))
            }
            return TimeLimits(total, apps, bonuses)
        }
    }
}

/**
 * Turns Android's usage events into foreground time per app since local midnight.
 * Pure: the Android side feeds it `UsageStatsManager.queryEvents`.
 */
object UsageCounter {
    enum class Kind { RESUMED, PAUSED, SCREEN_OFF }

    data class Event(val packageName: String, val kind: Kind, val atMs: Long)

    /** Where today starts in [zone], for the event query and the evaluation. */
    fun dayStartMs(now: Instant, zone: ZoneId): Long = now.atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()

    /**
     * @param events in time order, starting a little before [dayStartMs] so an app that was open at
     *   midnight is counted from midnight
     */
    fun foregroundMs(events: List<Event>, dayStartMs: Long, nowMs: Long): Map<String, Long> {
        val out = HashMap<String, Long>()
        var fg: String? = null
        var since = 0L
        fun close(at: Long) {
            val pkg = fg ?: return
            val from = maxOf(since, dayStartMs)
            val to = minOf(at, nowMs)
            if (to > from) out[pkg] = (out[pkg] ?: 0L) + (to - from)
            fg = null
        }
        for (e in events) {
            when (e.kind) {
                Kind.RESUMED -> if (fg != e.packageName) {
                    close(e.atMs)
                    fg = e.packageName
                    since = e.atMs
                }
                Kind.PAUSED -> if (fg == e.packageName) close(e.atMs)
                Kind.SCREEN_OFF -> close(e.atMs)
            }
        }
        close(nowMs)
        return out
    }
}
