// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SetupAudienceTest {
    @Test fun choicesRouteToTheExistingProfilesOrParentDashboard() {
        assertEquals("child", SetupAudience.CHILD.profile)
        assertNull(SetupAudience.PARENT.profile)
        assertEquals("self", SetupAudience.MYSELF.profile)
    }

    @Test fun undoExpiresAtExactlyTenMinutesOfElapsedTime() {
        val completed = 120_000L
        assertEquals(600_000L, setupUndoRemaining(completed, completed))
        assertEquals(1L, setupUndoRemaining(completed, completed + 599_999L))
        assertEquals(0L, setupUndoRemaining(completed, completed + 600_000L))
        assertEquals(0L, setupUndoRemaining(completed, completed - 1))
        assertEquals(0L, setupUndoRemaining(-1, completed))
    }

    @Test fun configurableUndoCountsElapsedTimeAndCapsItAtOneHour() {
        val completed = 120_000L
        assertEquals(0L, setupUndoRemaining(completed, completed, 0))
        assertEquals(299_999L, setupUndoRemaining(completed, completed + 1, 300_000L))
        assertEquals(1L, setupUndoRemaining(completed, completed + MAX_SETUP_UNDO_MS - 1, Long.MAX_VALUE))
        assertEquals(0L, setupUndoRemaining(completed, completed + MAX_SETUP_UNDO_MS, Long.MAX_VALUE))
    }

    @Test fun onlyMissingRolesAndGuardOnAndroid13OrLaterShowRestrictedSettingsHelp() {
        for (step in listOf(LightSetup.Step.PHONE, LightSetup.Step.SMS, LightSetup.Step.GUARD)) {
            assertTrue(needsRestrictedSettingsHelp(33, step, granted = false))
            assertFalse(needsRestrictedSettingsHelp(33, step, granted = true))
            assertFalse(needsRestrictedSettingsHelp(32, step, granted = false))
        }
        assertFalse(needsRestrictedSettingsHelp(35, LightSetup.Step.ADMIN, granted = false))
    }
}
