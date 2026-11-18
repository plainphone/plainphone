// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import android.os.SystemClock

/** Private device state. Only channels explicitly configured to reply are recorded by callers. */
internal class HelpReplies(
    context: Context,
    private val now: () -> Long = SystemClock::elapsedRealtime,
) {
    private val prefs = context.getSharedPreferences("plainphone_help_replies", Context.MODE_PRIVATE)
    private val boot = context.telephonyBootId()

    fun record(channel: Channel, number: String) {
        val key = "${channel.name}:$number"
        prefs.edit().putLong("$key:boot", boot).putLong(key, now()).apply()
    }

    /** A monotonic timestamp can only be compared within the same boot. */
    fun ageMs(channel: Channel, number: String): Long? {
        val key = "${channel.name}:$number"
        if (prefs.getLong("$key:boot", -1L) != boot) return null
        return prefs.getLong(key, -1L).takeIf { it >= 0 }?.let { now() - it }
    }
}
