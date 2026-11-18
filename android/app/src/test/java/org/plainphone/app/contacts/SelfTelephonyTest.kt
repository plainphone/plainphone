// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.plainphone.app.sync.Schedule

class SelfTelephonyTest {
    @Test
    fun favouritesCanCallAndTextDuringASchedule() {
        val favourite = "+4512345678"
        val unknown = "+4523456789"
        val zone = ZoneId.of("UTC")
        val schedule = Schedule("focus", "school", setOf(1), LocalTime.of(9, 0), LocalTime.of(10, 0), emptySet())
        val base = ContactRules(true, listOf(ApprovedContact("Alex", favourite)), PhoneNumbers.countryForIso("DK"))
        val policy = ContactPolicy(EmergencyCheck { it == "112" })
        val during = selfTelephonyRules(base, true, listOf(schedule), zone, Instant.parse("2026-11-16T09:30:00Z"))
        val after = selfTelephonyRules(base, true, listOf(schedule), zone, Instant.parse("2026-11-16T10:00:00Z"))
        for (channel in Channel.entries) {
            for (direction in Direction.entries) {
                assertTrue(policy.decide(during, channel, direction, favourite).allowed)
                assertFalse(policy.decide(during, channel, direction, unknown).allowed)
                assertTrue(policy.decide(after, channel, direction, unknown).allowed)
            }
            assertTrue(policy.decide(during, channel, Direction.OUTGOING, "112").allowed)
        }
    }
}
