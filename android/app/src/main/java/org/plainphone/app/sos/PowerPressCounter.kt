// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

/**
 * Counts power button presses for the hidden SOS (docs/sos.md). Each press turns the screen on or off,
 * so the caller feeds the time of every screen-on and screen-off event. It fires once when [needed]
 * events fall within [windowMs], then stays quiet for [cooldownMs] so one burst sends one SOS.
 * Pure, so it is tested on the JVM; times are from a monotonic clock (elapsedRealtime).
 */
class PowerPressCounter(
    private val windowMs: Long = WINDOW_MS,
    private val cooldownMs: Long = COOLDOWN_MS,
) {
    private val presses = ArrayDeque<Long>()
    private var firedAt: Long? = null

    /** Returns true exactly when this press completes the gesture. */
    fun press(atMs: Long, needed: Int): Boolean {
        val last = firedAt
        if (last != null && atMs - last < cooldownMs) {
            presses.clear()
            return false
        }
        presses.addLast(atMs)
        while (presses.isNotEmpty() && atMs - presses.first() > windowMs) presses.removeFirst()
        if (presses.size < needed) return false
        presses.clear()
        firedAt = atMs
        return true
    }

    fun reset() {
        presses.clear()
    }

    companion object {
        const val WINDOW_MS = 3_000L
        const val COOLDOWN_MS = 10_000L
    }
}
