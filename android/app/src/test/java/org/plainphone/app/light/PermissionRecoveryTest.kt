// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.R
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PermissionRecoveryTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Test fun androidStopsAskingAfterTheSecondDenialOrDontAskAgain() {
        assertFalse(PermissionRecovery.needsSettings(0, canShowRationale = false))
        assertFalse(PermissionRecovery.needsSettings(1, canShowRationale = true))
        assertTrue(PermissionRecovery.needsSettings(1, canShowRationale = false)) // "don't ask again" on Android 10
        assertTrue(PermissionRecovery.needsSettings(2, canShowRationale = true))
    }

    @Test fun denialsAndBlocksSurviveAnAppRestartAndClearTogether() {
        val step = LightSetup.Step.LOCATION
        assertEquals(0, PermissionRecovery.denials(context, step))
        PermissionRecovery.recordDenial(context, step)
        PermissionRecovery.recordDenial(context, step)
        PermissionRecovery.markBlocked(context, step)
        PermissionRecovery.markRestricted(context, LightSetup.Step.GUARD)

        // A fresh read, as after the process was killed: the state is on disk, not in memory.
        assertEquals(2, PermissionRecovery.denials(context, step))
        assertTrue(PermissionRecovery.blocked(context, step))
        assertTrue(PermissionRecovery.restricted(context, LightSetup.Step.GUARD))
        assertFalse(PermissionRecovery.blocked(context, LightSetup.Step.RUNNING))

        PermissionRecovery.clear(context, step)
        assertEquals(0, PermissionRecovery.denials(context, step))
        assertFalse(PermissionRecovery.blocked(context, step))
        assertTrue(PermissionRecovery.restricted(context, LightSetup.Step.GUARD))
    }

    @Test fun onlyOptionalStepsExplainWhatSkippingCosts() {
        for (step in LightSetup.Step.entries) {
            val effect = PermissionRecovery.skipEffect(step)
            if (step.optional) assertTrue("${step.name} needs a skip line", effect != null) else assertNull(effect)
        }
        assertEquals(R.string.light_skip_effect_location, PermissionRecovery.skipEffect(LightSetup.Step.LOCATION))
    }

    @Test fun backStepsOneScreenAndSkipsLightOnlyQuestionsWhenTheyDoNotApply() {
        assertNull(MyselfStage.VPN.previous(light = true))
        assertEquals(MyselfStage.VPN, MyselfStage.UNDO.previous(light = true))
        assertEquals(MyselfStage.UNDO, MyselfStage.KEY.previous(light = true))
        assertNull(MyselfStage.KEY.previous(light = false))
        assertEquals(MyselfStage.KEY, MyselfStage.CONFIRM.previous(light = false))
        assertEquals(MyselfStage.KEY, MyselfStage.first(light = false))
    }
}
