// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.os.SystemClock
import org.plainphone.app.contacts.PhoneNumbers

/**
 * The numbers the phone dialled in the last [WINDOW_MS], whichever app dialled them. Telecom can hand
 * over a call without a direction after the phone process restarts (issue #273). Such a call to a number
 * that was just dialled is the child's own. Any other one rang in.
 *
 * Kept in memory only: the window is short, and if Plainphone's own process restarted too, the call
 * counts as incoming. It is ended either way when the number is not approved.
 */
object RecentDials {
    /** Long enough for the phone process to restart, short enough that a later stranger's call is not mistaken. */
    const val WINDOW_MS = 60_000L

    private val dials = ArrayDeque<Pair<String, Long>>()

    @Synchronized
    fun record(number: String?, nowMs: Long = SystemClock.elapsedRealtime()) {
        if (number.isNullOrBlank()) return
        prune(nowMs)
        dials.addLast(number to nowMs)
    }

    /** Whether [number] was dialled in the last [WINDOW_MS]. Numbers are compared in their normalised form. */
    @Synchronized
    fun wasJustDialled(
        number: String?,
        country: PhoneNumbers.Country?,
        nowMs: Long = SystemClock.elapsedRealtime(),
    ): Boolean {
        if (number.isNullOrBlank()) return false
        prune(nowMs)
        return dials.any { (dialled, _) -> dialled == number || PhoneNumbers.same(dialled, number, country) }
    }

    @Synchronized
    internal fun clear() = dials.clear()

    private fun prune(nowMs: Long) {
        while (dials.isNotEmpty() && nowMs - dials.first().second > WINDOW_MS) dials.removeFirst()
    }
}
