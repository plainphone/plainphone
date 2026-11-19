// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

internal const val SOS_HOLD_MS = 3_000L
internal const val SOS_CANCEL_MS = 5_000L

internal class SosConfirmation(private val kind: SosKind, now: Long) {
    val deadline = now + SOS_CANCEL_MS
    private var finished = false

    fun cancel() {
        finished = true
    }

    fun sendIfDue(now: Long): SosKind? {
        if (finished || now < deadline) return null
        finished = true
        return kind
    }
}

internal enum class SosCallOutcome { UNANSWERED, ANSWERED, STOPPED }

internal suspend fun <T> callSosParents(parents: Iterable<T>, attempt: suspend (T) -> SosCallOutcome) {
    for (parent in parents) {
        if (attempt(parent) != SosCallOutcome.UNANSWERED) return
    }
}
