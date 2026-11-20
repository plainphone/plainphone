// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

/**
 * The three strictness levels of the phone's own (Myself) key. They are only a friendlier way to
 * pick what was always there: a wait time, or a person I trust. Nothing new is stored or sent,
 * so older servers keep working ([LightSetup.saveSelfKey] still saves hours or a trusted person).
 */
enum class SelfLevel {
    /** Wait 1 hour. */
    MILD,
    /** Wait 24 hours. */
    FIRM,
    /** A person I trust approves. */
    STRICT,
    /** Any other wait time, chosen under "Advanced". */
    CUSTOM;

    companion object {
        const val MILD_HOURS = 1
        const val FIRM_HOURS = 24

        /** Every wait time the server accepts for a delay key. */
        val WAIT_HOURS = listOf(1, 6, 12, 24, 48, 72)

        /** The level for a key: null while nothing is chosen (no trusted person and no wait time). */
        fun of(waitHours: Int?, trusted: Boolean): SelfLevel? = when {
            trusted -> STRICT
            waitHours == null -> null
            waitHours == MILD_HOURS -> MILD
            waitHours == FIRM_HOURS -> FIRM
            else -> CUSTOM
        }
    }
}
