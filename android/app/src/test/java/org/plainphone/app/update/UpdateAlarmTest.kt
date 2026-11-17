// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.update

import android.app.AlarmManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PlainphoneAdminReceiver
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class UpdateAlarmTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val alarms = shadowOf(context.getSystemService(AlarmManager::class.java))

    @Before fun becomeDeviceOwner() {
        val dpm = shadowOf(context.getSystemService(DevicePolicyManager::class.java))
        val admin = PlainphoneAdminReceiver.component(context)
        dpm.setActiveAdmin(admin)
        assertTrue(dpm.setDeviceOwner(admin))
    }

    @Test fun strongModeArmsAnExactElapsedTimeWakeupWhileIdle() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        val expiry = SystemClock.elapsedRealtime() + 360_000L
        UpdateReceiver.scheduleLeaseExpiry(context, InstallLease.SELF_UPDATE, expiry)
        val alarm = alarms.scheduledAlarms.single()
        assertEquals(AlarmManager.ELAPSED_REALTIME_WAKEUP, alarm.getType())
        assertEquals(expiry, alarm.triggerAtMs)
        assertEquals(0L, alarm.windowLengthMs)
        assertTrue(alarm.isAllowWhileIdle)
    }

    @Test fun strongModeRefusesToScheduleAnInexactFallback() {
        ShadowAlarmManager.setCanScheduleExactAlarms(false)
        assertThrows(IllegalStateException::class.java) {
            UpdateReceiver.scheduleLeaseExpiry(context, InstallLease.SELF_UPDATE, 360_000L)
        }
        assertTrue(alarms.scheduledAlarms.isEmpty())
    }
}
