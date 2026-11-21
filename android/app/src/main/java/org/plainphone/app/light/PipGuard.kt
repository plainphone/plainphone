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
     * that app right now. Our own screens and unreadable windows are left alone.
     */
    fun targets(
        windows: List<Win>,
        ownPackage: String,
        plan: LightPlan,
        openedForNow: (String) -> Boolean,
    ): List<Target> = packages(windows, ownPackage)
        .mapNotNull { pkg -> plan.why(pkg)?.let { Target(pkg, it) } }
        .filterNot { openedForNow(it.pkg) }

    /** Picture-in-picture packages, for the live time check (the plan may not know yet that time is up). */
    fun packages(windows: List<Win>, ownPackage: String): List<String> =
        windows.filter { it.inPip }.mapNotNull { it.pkg }.filter { it != ownPackage }.distinct()
}
