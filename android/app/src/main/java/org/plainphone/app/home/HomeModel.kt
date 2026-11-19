// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import java.text.Collator
import java.time.Instant
import java.time.LocalTime
import java.util.Locale
import org.plainphone.app.quiet.BedtimeQuiet
import org.plainphone.app.sync.Schedules
import org.plainphone.app.sync.ServerRules

/** One launcher entry on the phone. [component] is a flattened ComponentName. */
data class LaunchableApp(val packageName: String, val label: String, val component: String)

/** An app as the home screen shows it. [minutesLeft] is null when the app has no time limit today. */
data class HomeApp(val packageName: String, val label: String, val component: String, val minutesLeft: Int? = null)

/**
 * School time or bedtime, shown quietly under the date. [silent] is set during bedtime when "Silent bedtime"
 * is on: the child is told that the phone is silent, and why.
 */
data class WindowNotice(val kind: Kind, val until: LocalTime, val silent: Boolean = false) {
    enum class Kind { SCHOOL, BEDTIME }
}

data class HomeState(
    val prefs: HomePrefs,
    /** The front page, in the parent's order. */
    val favourites: List<HomeApp>,
    /** Every app the rules allow right now, by name. */
    val all: List<HomeApp>,
    val notice: WindowNotice?,
)

/**
 * Decides what the home screen shows. Pure, so it is tested on the JVM.
 *
 * In strong mode Android has already hidden what the rules forbid, so [apps] is the truth. In light
 * mode nothing is hidden by Android, so the rules are applied here too: an app the parent hid, or one
 * that school time does not allow, never shows.
 */
object HomeModel {
    fun build(
        apps: List<LaunchableApp>,
        rules: ServerRules?,
        now: Instant,
        /** Components the home screen already has as fixed buttons (phone, messages): not listed again. */
        fixed: Set<String> = emptySet(),
        /** Apps Android needs whatever the rules say (dialer, camera, clock, Settings ...). */
        core: Set<String> = emptySet(),
        minutesLeft: Map<String, Int> = emptyMap(),
        /** Sorts the app names the way the user's language does (Danish: ... Z Æ Ø Å). */
        locale: Locale = Locale.getDefault(),
    ): HomeState {
        val prefs = rules?.home ?: HomePrefs.DEFAULT
        val windows = rules?.let { Schedules.active(it.schedules, now, it.timezone) }.orEmpty()
        val windowAllowed = Schedules.allowedDuringWindows(windows)
        // Only what the rules allow: an app installed since the last sync is in neither list yet,
        // and stays off the home screen until the parent allows it. Catalog picks count as allowed.
        // Open mode (without a window): every app shows except the block list, also new ones.
        val open = rules != null && rules.openApps && windowAllowed == null
        val allowed = rules?.let { r -> r.allowedApps + r.toInstall.map { it.packageName } }
        val visible = apps
            .asSequence()
            .filter { it.component !in fixed }
            .filter {
                when {
                    open -> it.packageName in core || it.packageName !in rules!!.blockedApps
                    else -> allowed == null || it.packageName in core || it.packageName in allowed
                }
            }
            .filter { windowAllowed == null || it.packageName in core || it.packageName in windowAllowed }
            .map { HomeApp(it.packageName, it.label, it.component, minutesLeft[it.packageName]) }
            .distinctBy { it.component }
            .sortedWith(compareBy(Collator.getInstance(locale)) { it.label })
            .toList()
        val byPackage = visible.groupBy { it.packageName }
        // Nothing chosen: the front page is the clock, phone and messages (docs/phone-settings.md).
        // A package can have several launcher entries; the front page shows the first by name.
        val favourites = prefs.apps.mapNotNull { byPackage[it]?.first() }
        val silent = rules != null && BedtimeQuiet.silent(rules, windows)
        return HomeState(prefs, favourites, visible, notice(windows, silent))
    }

    /** The window that ends last decides the "until" time; bedtime wins over school time. */
    private fun notice(windows: List<org.plainphone.app.sync.Schedule>, silent: Boolean): WindowNotice? {
        if (windows.isEmpty()) return null
        val bedtime = windows.filter { it.kind == "bedtime" }
        val pick = (bedtime.ifEmpty { windows }).maxBy { it.end }
        val kind = if (pick.kind == "bedtime") WindowNotice.Kind.BEDTIME else WindowNotice.Kind.SCHOOL
        return WindowNotice(kind, pick.end, silent = silent && kind == WindowNotice.Kind.BEDTIME)
    }
}
