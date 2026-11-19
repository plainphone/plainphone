// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.push

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PhoneWakeTest {
    @Test fun rejectedFcmTokenFallsBackToUnifiedPush() {
        assertEquals(WakeRegistration("unifiedpush", "endpoint"),
            selectWakeProvider("fcm", true, { "wrong-project" }, { "endpoint" }, { false }))
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
