// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.quiet

import java.time.Instant
import org.plainphone.app.time.TrustedTime
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.sync.Schedule
import org.plainphone.app.sync.Schedules
import org.plainphone.app.sync.ServerRules

/**
 * Silent bedtime (docs/bedtime.md): while a bedtime window is on and the parent kept "Silent bedtime"
 * on, the phone makes no sound and shows no notifications. Calls from parents, 112 and help lines
 * still ring. Pure logic, unit-tested on the JVM; the Android side is in [BedtimeDnd], the call
 * screening and the notifications.
 */
object BedtimeQuiet {

    /** Whether the phone is silent for the given active [windows]. */
    fun silent(rules: ServerRules, windows: List<Schedule>): Boolean =
        rules.silentBedtime && windows.any { it.kind == "bedtime" }

    /** Whether the phone is silent at [now]. */
    fun silentNow(rules: ServerRules?, now: Instant): Boolean = silentNow(rules, TrustedTime.at(now))

    /** The same with the phone's trusted time (time/TrustedClock.kt): bedtime that may be on counts. */
    fun silentNow(rules: ServerRules?, now: TrustedTime): Boolean =
        rules != null && silent(rules, Schedules.active(rules.schedules, now, rules.timezone))

    /**
     * Who may still ring at bedtime: the contacts the parent marked as parents. When no one is marked,
     * every approved contact may ring, because the phone cannot tell who the parents are and a parent
     * must always be able to get through ([docs/design-principles.md], principle 3).
     */
    fun ringers(rules: ServerRules): List<ApprovedContact> {
        val parents = rules.sos?.parents.orEmpty()
        return if (parents.isNotEmpty()) parents else rules.contacts
    }
}
