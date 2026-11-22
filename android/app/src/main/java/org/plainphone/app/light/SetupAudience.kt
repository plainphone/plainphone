// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import org.plainphone.app.R
import org.plainphone.app.distribution.Distribution

internal enum class SetupAudience(val profile: String?, val label: Int) {
    CHILD("child", R.string.setup_child),
    PARENT(null, R.string.setup_parent),
    MYSELF("self", R.string.setup_myself),
    ;

    companion object {
        /** The first setup screen's choices. The Play edition has no Myself (docs/play/play-edition.md). */
        fun offered(): List<SetupAudience> = entries.filter { it != MYSELF || Distribution.MYSELF_PROFILE }
    }
}

internal fun needsRestrictedSettingsHelp(sdk: Int, step: LightSetup.Step?, granted: Boolean): Boolean =
    sdk >= 33 && !granted && when (step) {
        LightSetup.Step.PHONE, LightSetup.Step.SMS, LightSetup.Step.GUARD -> true
        else -> false
    }

internal const val SETUP_UNDO_MS = 10 * 60_000L

internal const val MAX_SETUP_UNDO_MS = 60 * 60_000L
internal val SETUP_UNDO_CHOICES = listOf(0, 5, 10, 30, 60)

internal fun setupUndoRemaining(completedElapsed: Long, nowElapsed: Long, durationMs: Long = SETUP_UNDO_MS): Long {
    if (completedElapsed < 0 || nowElapsed < completedElapsed) return 0
    return (durationMs.coerceIn(0, MAX_SETUP_UNDO_MS) - (nowElapsed - completedElapsed)).coerceAtLeast(0)
}
