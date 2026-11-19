// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.annotation.SuppressLint
import android.content.Context
import android.content.SharedPreferences
import java.time.LocalDate
import org.plainphone.app.sync.TimeLimits

/**
 * The quiet 5-minute warning before a time limit runs out (docs/time-limits.md). Pure decisions,
 * unit-tested on the JVM; [LimitWarningNotifier] shows them.
 *
 * Only the limit that runs out first is named: the app's own cap or the daily cap. Never for core
 * apps (they are never counted, so calls, messages, parents, 112 and help lines are untouched),
 * never while school time or bedtime applies (the windows already decide what can be open), and
 * only when the parent left the warning on.
 */
object LimitWarning {
    const val WINDOW_MS = 5 * 60_000L
    const val WINDOW_MINUTES = 5

    /** [target] is a package or [TimeLimits.TOTAL]; [capMinutes] is today's cap with bonuses. */
    data class Due(val target: String, val capMinutes: Int, val remainingMs: Long) {
        val isTotal: Boolean get() = target == TimeLimits.TOTAL
    }

    /**
     * The warning for [pkg] in front right now, or null. When both caps end within the window, the
     * one that runs out first wins; on a tie the daily cap, since it closes more.
     */
    fun due(
        limits: TimeLimits,
        evaluation: TimeLimits.Evaluation,
        pkg: String,
        date: LocalDate,
        exempt: Set<String>,
        enabled: Boolean,
        quiet: Boolean,
    ): Due? {
        if (!enabled || quiet || pkg in exempt) return null
        val total = totalDue(limits, evaluation, date)
        val app = evaluation.appRemainingMs[pkg]?.let { Due(pkg, limits.capMinutes(pkg, date) ?: return@let null, it) }
        return listOfNotNull(total, app).minByOrNull { it.remainingMs }?.takeIf { it.remainingMs in 1..WINDOW_MS }
    }

    /**
     * What Plainphone's own home screen shows: the daily cap, or the app that was warned about last
     * while its time is still running out. Null when nothing is close.
     */
    fun banner(
        limits: TimeLimits,
        evaluation: TimeLimits.Evaluation,
        lastWarnedApp: String?,
        date: LocalDate,
        exempt: Set<String>,
        enabled: Boolean,
        quiet: Boolean,
    ): Due? {
        if (!enabled || quiet) return null
        lastWarnedApp?.let { due(limits, evaluation, it, date, exempt, enabled = true, quiet = false) }?.let { return it }
        return totalDue(limits, evaluation, date)?.takeIf { it.remainingMs in 1..WINDOW_MS }
    }

    private fun totalDue(limits: TimeLimits, evaluation: TimeLimits.Evaluation, date: LocalDate): Due? {
        val remaining = evaluation.totalRemainingMs ?: return null
        return Due(TimeLimits.TOTAL, limits.capMinutes(TimeLimits.TOTAL, date) ?: return null, remaining)
    }
}

/**
 * "Already warned" marks: at most one warning per target, cap and local day. The cap is part of the
 * key, so a bonus that moves the end gives exactly one more warning before the new end. Marks of
 * other days are dropped when a new one is written.
 */
class LimitWarningMarks(private val prefs: SharedPreferences) {
    constructor(context: Context) : this(context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE))

    /** True the first time [due] comes up on [date] (then the caller warns); false after that. */
    @SuppressLint("ApplySharedPref") // A crash right after warning must not warn twice.
    fun claim(date: LocalDate, due: LimitWarning.Due): Boolean = synchronized(LOCK) {
        val key = "$PREFIX$date|${due.target}|${due.capMinutes}"
        if (prefs.contains(key)) return@synchronized false
        val edit = prefs.edit()
        prefs.all.keys.filter { it.startsWith(PREFIX) && !it.startsWith("$PREFIX$date|") }.forEach { edit.remove(it) }
        edit.putBoolean(key, true)
        if (!due.isTotal) edit.putString(KEY_LAST_APP, "$date|${due.target}")
        edit.commit()
        true
    }

    /** The app warned about last today, for the home screen's notice. */
    fun lastWarnedApp(date: LocalDate): String? =
        prefs.getString(KEY_LAST_APP, null)?.split('|', limit = 2)?.takeIf { it.size == 2 && it[0] == date.toString() }?.get(1)

    companion object {
        const val PREFS = "plainphone_time_warnings"
        private const val PREFIX = "warned|"
        private const val KEY_LAST_APP = "last_app"
        private val LOCK = Any()
    }
}
