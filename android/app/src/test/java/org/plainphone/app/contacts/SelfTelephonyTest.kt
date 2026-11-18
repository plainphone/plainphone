// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import org.json.JSONObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.Schedule
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SelfTelephonyTest {
    @Test
    fun cachedStrongSelfRulesKeepTheExistingRestriction() {
        val old = JSONObject(rulesJson()).put("profile", "self").toString()
        val legacy = JSONObject(old).put("selfScheduleContacts", JSONObject.NULL).toString()
        val unrestricted = JSONObject(old).put("selfScheduleContacts", false).toString()
        val at = Instant.parse("2026-11-16T09:30:00Z")
        for (json in listOf(old, legacy, unrestricted)) {
            val server = ServerRules.parse(json)
            val base = ContactRules(true, server.contacts, PhoneNumbers.countryForIso("DK"))
            val rules = selfTelephonyRules(base, server.selfScheduleContacts, server.schedules, server.timezone, at)
            val policy = ContactPolicy(EmergencyCheck { it == "112" })
            for (channel in Channel.entries) {
                for (direction in Direction.entries) {
                    assertTrue(policy.decide(rules, channel, direction, "+4512345678").allowed)
                    val unknownAllowed = policy.decide(rules, channel, direction, "+4523456789").allowed
                    if (json == unrestricted) assertTrue(unknownAllowed) else assertFalse(unknownAllowed)
                }
            }
        }
    }

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
