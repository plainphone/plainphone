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
        assertEquals(600_000L, setupUndoRemaining(completed, completed, SETUP_UNDO_MS))
        assertEquals(1L, setupUndoRemaining(completed, completed + 599_999L, SETUP_UNDO_MS))
        assertEquals(0L, setupUndoRemaining(completed, completed + 600_000L, SETUP_UNDO_MS))
        assertEquals(0L, setupUndoRemaining(completed, completed - 1, SETUP_UNDO_MS))
        assertEquals(8L, setupUndoRemaining(completed, completed + 2, 10))
        assertEquals(0L, setupUndoRemaining(completed, completed, 0))
        assertEquals(0L, setupUndoRemaining(-1, completed, SETUP_UNDO_MS))
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
