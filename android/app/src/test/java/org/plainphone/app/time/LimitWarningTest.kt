// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.TimeLimits
import org.plainphone.app.sync.TimeLimits.Bonus
import org.plainphone.app.sync.TimeLimits.Limit
import org.robolectric.RobolectricTestRunner

/** The 5-minute warning: when it is due, and that it comes once per limit and day. Robolectric for the marks' prefs. */
@RunWith(RobolectricTestRunner::class)
class LimitWarningTest {
    private val day = LocalDate.of(2027, 1, 4)
    private val spotify = "com.spotify.music"
    private val game = "com.example.game"
    private val dialer = "com.android.dialer"
    private val min = 60_000L

    private fun limits(total: Int? = 120, app: Int? = 30, bonuses: List<Bonus> = emptyList()) = TimeLimits(
        total?.let { Limit(it) },
        listOfNotNull(app?.let { spotify to Limit(it) }).toMap(),
        bonuses,
    )

    private fun due(limits: TimeLimits, used: Map<String, Long>, pkg: String = spotify, enabled: Boolean = true, quiet: Boolean = false) =
        LimitWarning.due(limits, limits.evaluate(used, day, setOf(dialer)), pkg, day, setOf(dialer), enabled, quiet)

    @Test
    fun `due inside the last five minutes of the app's own cap, not before and not after`() {
        val l = limits()
        assertThat(due(l, mapOf(spotify to 24 * min))).isNull()
        assertThat(due(l, mapOf(spotify to 25 * min))).isEqualTo(LimitWarning.Due(spotify, 30, 5 * min))
        assertThat(due(l, mapOf(spotify to 29 * min + 59_000))?.target).isEqualTo(spotify)
        assertThat(due(l, mapOf(spotify to 30 * min))).isNull() // used up: the stop screen takes over
    }

    @Test
    fun `the total wins when it runs out first, also for an app without its own cap`() {
        val l = limits(total = 60)
        val due = due(l, mapOf(spotify to 10 * min, game to 46 * min))
        assertThat(due).isEqualTo(LimitWarning.Due(TimeLimits.TOTAL, 60, 4 * min))
        assertThat(due!!.isTotal).isTrue()
        assertThat(due(l, mapOf(game to 56 * min), pkg = game)?.target).isEqualTo(TimeLimits.TOTAL)
        // The app's cap runs out first.
        assertThat(due(limits(total = 120), mapOf(spotify to 27 * min, game to 60 * min))?.target).isEqualTo(spotify)
    }

    @Test
    fun `nothing without a cap, for core apps, when switched off or in a quiet window`() {
        assertThat(due(limits(total = null, app = null), mapOf(spotify to 500 * min))).isNull()
        assertThat(due(limits(total = 60), mapOf(game to 57 * min), pkg = dialer)).isNull()
        assertThat(due(limits(), mapOf(spotify to 27 * min), enabled = false)).isNull()
        assertThat(due(limits(), mapOf(spotify to 27 * min), quiet = true)).isNull()
    }

    @Test
    fun `calls do not count towards the total`() {
        // An hour on the phone with a parent leaves the total untouched.
        assertThat(due(limits(total = 60, app = null), mapOf(dialer to 60 * min, spotify to 50 * min))).isNull()
    }

    @Test
    fun `a bonus moves the end, so the cap in the warning moves with it`() {
        val l = limits(bonuses = listOf(Bonus(spotify, day, 15)))
        assertThat(due(l, mapOf(spotify to 30 * min))).isNull()
        assertThat(due(l, mapOf(spotify to 41 * min))).isEqualTo(LimitWarning.Due(spotify, 45, 4 * min))
    }

    @Test
    fun `the home screen names the last warned app, else the total`() {
        val l = limits(total = 60)
        val e = l.evaluate(mapOf(spotify to 27 * min, game to 10 * min), day, setOf(dialer))
        assertThat(LimitWarning.banner(l, e, spotify, day, setOf(dialer), enabled = true, quiet = false)?.target).isEqualTo(spotify)
        assertThat(LimitWarning.banner(l, e, null, day, setOf(dialer), enabled = true, quiet = false)).isNull()
        val nearTotal = l.evaluate(mapOf(game to 57 * min), day, setOf(dialer))
        assertThat(LimitWarning.banner(l, nearTotal, null, day, setOf(dialer), enabled = true, quiet = false)?.target).isEqualTo(TimeLimits.TOTAL)
        assertThat(LimitWarning.banner(l, nearTotal, null, day, setOf(dialer), enabled = false, quiet = false)).isNull()
        assertThat(LimitWarning.banner(l, nearTotal, null, day, setOf(dialer), enabled = true, quiet = true)).isNull()
    }

    @Test
    fun `one warning per target and day, a new cap after a bonus gives one more`() {
        val marks = LimitWarningMarks(prefs())
        val first = LimitWarning.Due(spotify, 30, 4 * min)
        assertThat(marks.claim(day, first)).isTrue()
        assertThat(marks.claim(day, first.copy(remainingMs = 2 * min))).isFalse()
        assertThat(marks.claim(day, LimitWarning.Due(TimeLimits.TOTAL, 120, 3 * min))).isTrue()
        assertThat(marks.claim(day, LimitWarning.Due(spotify, 45, 4 * min))).isTrue()
        assertThat(marks.claim(day, LimitWarning.Due(spotify, 45, 1 * min))).isFalse()
        assertThat(marks.lastWarnedApp(day)).isEqualTo(spotify)
        assertThat(marks.lastWarnedApp(day.plusDays(1))).isNull()
    }

    @Test
    fun `marks of earlier days are cleaned and do not block the next day`() {
        val prefs = prefs()
        val marks = LimitWarningMarks(prefs)
        assertThat(marks.claim(day, LimitWarning.Due(spotify, 30, 4 * min))).isTrue()
        assertThat(marks.claim(day.plusDays(1), LimitWarning.Due(spotify, 30, 4 * min))).isTrue()
        assertThat(prefs.all.keys.filter { it.contains(day.toString()) && it.startsWith("warned") }).isEmpty()
        assertThat(prefs.all.keys.count { it.startsWith("warned") }).isEqualTo(1)
    }

    private fun prefs() = ApplicationProvider.getApplicationContext<Context>()
        .getSharedPreferences("limit-warning-test-${System.nanoTime()}", Context.MODE_PRIVATE)
}
