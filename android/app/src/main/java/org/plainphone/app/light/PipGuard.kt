// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

/**
 * Decides which picture-in-picture windows the guard has to close. A blocked video app can enter
 * picture-in-picture just as `block()` sends Home, and entering it only produces a windows-changed
 * event, never "an app came to the front". Pure, so the decision is testable without a phone.
 */
object PipGuard {
    /** One window as the guard sees it: its root's package (null when unreadable) and its mode. */
    data class Win(val pkg: String?, val inPip: Boolean)

    /** A picture-in-picture app that has to go, and why. */
    data class Target(val pkg: String, val why: LightPlan.Why)

    /**
     * The picture-in-picture windows whose app the plan blocks, unless an emergency opening covers
     * that app right now. Our own screens and unreadable windows are left alone. An app in
     * [alreadyStopped] has had its stop screen once for this window: showing it again every tick
     * would push the phone (a call screen too) away for as long as the window floats.
     */
    fun targets(
        windows: List<Win>,
        ownPackage: String,
        plan: LightPlan,
        alreadyStopped: Set<String> = emptySet(),
        openedForNow: (String) -> Boolean,
    ): List<Target> = packages(windows, ownPackage)
        .filterNot { it in alreadyStopped }
        .mapNotNull { pkg -> plan.why(pkg)?.let { Target(pkg, it) } }
        .filterNot { openedForNow(it.pkg) }

    /**
     * Blocked windows in [alreadyStopped] that still float. Android 10 can ignore a dismiss sent
     * while the window is still entering picture-in-picture, so the guard sends it again (it is
     * invisible); only the stop screen stays once per window.
     */
    fun stillFloating(
        windows: List<Win>,
        ownPackage: String,
        plan: LightPlan,
        alreadyStopped: Set<String>,
        openedForNow: (String) -> Boolean,
    ): List<Target> = targets(windows, ownPackage, plan, openedForNow = openedForNow).filter { it.pkg in alreadyStopped }

    /**
     * True while an app asked to leave picture-in-picture (at [expandedAt], elapsed time) may still be
     * arriving in front. Its stop screen must not press Home then: a video app answers the user leaving
     * by floating again.
     */
    fun expandedRecently(expandedAt: Long?, now: Long): Boolean =
        expandedAt != null && now - expandedAt in 0..EXPAND_QUIET_MS

    /** Long enough for Android's expand animation and a stop screen dropped by the guard's rate limit. */
    const val EXPAND_QUIET_MS = 5_000L

    /** Picture-in-picture packages, for the live time check (the plan may not know yet that time is up). */
    fun packages(windows: List<Win>, ownPackage: String): List<String> =
        windows.filter { it.inPip }.mapNotNull { it.pkg }.filter { it != ownPackage }.distinct()
}
