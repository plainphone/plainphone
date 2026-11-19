// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.ServerRules
import org.robolectric.RobolectricTestRunner
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(RobolectricTestRunner::class)
class PhoneWakeTest {
    @Test fun rejectedFcmTokenFallsBackToUnifiedPush() {
        assertEquals(WakeRegistration("unifiedpush", "endpoint"),
            selectWakeProvider("fcm", true, { "wrong-project" }, { "endpoint" }, { false }))
    }

    @Test fun transientFcmValidationFailureFallsBackToUnifiedPush() {
        assertEquals(WakeRegistration("unifiedpush", "endpoint"),
            selectWakeProvider("fcm", true, { "token" }, { "endpoint" }, { throw HttpError(503, "unavailable") }))
    }

    @Test fun upgradeAndProjectChangeInvalidateCachedFcmRegistration() {
        val old = """
            {"phoneId":"phone","profile":"child","timezone":"UTC","pushProvider":"fcm","unifiedPushAvailable":true,
             "apps":{"allowed":[],"hidden":[]},"dns":{},"location":{"enabled":false,"intervalMinutes":15},
             "contacts":[],"schedules":[]}
        """.trimIndent()
        val projectA = old.replace("\"pushProvider\"", "\"fcmValidationKey\":\"v1:project-a\",\"pushProvider\"")
        val projectB = projectA.replace("project-a", "project-b")
        val upgraded = wakeRegistrationPolicy(ServerRules.parse(projectA))
        assertNotEquals("phone:fcm:true", wakeRegistrationPolicy(ServerRules.parse(old)))
        assertNotEquals(upgraded, wakeRegistrationPolicy(ServerRules.parse(old)))
        assertNotEquals(upgraded, wakeRegistrationPolicy(ServerRules.parse(projectB)))
        assertEquals(upgraded, wakeRegistrationPolicy(ServerRules.parse(projectA)))
    }

    @Test fun selectsFcmBeforeUnifiedPush() {
        assertEquals(WakeRegistration("fcm", "fcm-token"),
            selectWakeProvider("fcm", true, { "fcm-token" }, { error("fallback not needed") }))
    }

    @Test fun fallsBackToUnifiedPushAndThenPolling() {
        assertEquals(WakeRegistration("unifiedpush", "https://push.example.org/up"),
            selectWakeProvider("fcm", true, { null }, { "https://push.example.org/up" }))
        assertEquals(WakeRegistration("none"), selectWakeProvider("fcm", true, { null }, { null }))
    }

    @Test fun neverContactsFcmInUnifiedPushModeOrEitherProviderWhenDisabled() {
        val unavailable: () -> String? = { error("provider disabled") }
        assertEquals(WakeRegistration("unifiedpush", "endpoint"),
            selectWakeProvider("unifiedpush", true, unavailable, { "endpoint" }))
        assertEquals(WakeRegistration("none"), selectWakeProvider("none", true, unavailable, unavailable))
    }

    @Test fun acceptsOnlyKnownWakeReasons() {
        for (reason in listOf("rules", "locate", "update", "sos-ack")) assertEquals(reason, PhoneWake.reason(reason))
        assertNull(PhoneWake.reason("install"))
        assertNull(PhoneWake.reason("rules "))
        assertNull(PhoneWake.reason(null))
    }
}
