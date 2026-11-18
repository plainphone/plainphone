// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

internal enum class SetupAudience(val profile: String?) {
    CHILD("child"),
    PARENT(null),
    MYSELF("self"),
}

internal fun needsRestrictedSettingsHelp(sdk: Int, step: LightSetup.Step?, granted: Boolean): Boolean =
    sdk >= 33 && !granted && when (step) {
        LightSetup.Step.PHONE, LightSetup.Step.SMS, LightSetup.Step.GUARD -> true
        else -> false
    }

internal const val SETUP_UNDO_MS = 10 * 60_000L

internal fun setupUndoRemaining(completedElapsed: Long, nowElapsed: Long): Long {
    if (completedElapsed < 0 || nowElapsed < completedElapsed) return 0
    return (SETUP_UNDO_MS - (nowElapsed - completedElapsed)).coerceAtLeast(0)
}

internal const val SETUP_UNDO_RETRY_MS = 2 * 60_000L

internal fun setupUndoTapAge(tappedAt: Long, now: Long): Long? =
    if (tappedAt < 0 || tappedAt > now) null else (now - tappedAt).takeIf { it <= SETUP_UNDO_RETRY_MS }
