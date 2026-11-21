// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

/**
 * At most one [action] per [gapMs]. The first call runs at once; calls inside the gap are folded into
 * one trailing run at the end of the gap, so the last change is never lost. [schedule] runs a task
 * after a delay (a handler in the app, a fake in tests).
 */
class Debounce(
    private val gapMs: Long,
    private val now: () -> Long,
    private val schedule: (delayMs: Long, task: () -> Unit) -> Unit,
    private val action: () -> Unit,
) {
    private var lastRunAt: Long? = null
    private var trailingScheduled = false

    fun trigger() {
        val delay = synchronized(this) {
            val last = lastRunAt
            if (last == null || now() - last >= gapMs) {
                lastRunAt = now()
                null
            } else if (trailingScheduled) {
                return
            } else {
                trailingScheduled = true
                gapMs - (now() - last)
            }
        }
        if (delay == null) {
            action()
        } else {
            schedule(delay) {
                synchronized(this) {
                    trailingScheduled = false
                    lastRunAt = now()
                }
                action()
            }
        }
    }
}
