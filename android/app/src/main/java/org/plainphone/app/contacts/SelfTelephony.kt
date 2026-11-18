// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import java.time.Instant
import java.time.ZoneId
import org.plainphone.app.sync.Schedule
import org.plainphone.app.sync.Schedules

internal fun selfTelephonyRules(
    base: ContactRules, restricted: Boolean?, schedules: List<Schedule>, zone: ZoneId, now: Instant,
): ContactRules = base.copy(
    enforced = base.enforced && when (restricted) {
        null -> true
        true -> Schedules.active(schedules, now, zone).isNotEmpty()
        false -> false
    },
    selfProfile = true,
)
