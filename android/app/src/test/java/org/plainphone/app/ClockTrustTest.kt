// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** In light mode the child can set the date: the PIN lockout and a maintenance unlock must not follow it. */
@RunWith(RobolectricTestRunner::class)
class ClockTrustTest {
    private var wall = 1_000_000_000L
    private var elapsed = 50_000L
    private var boot = 3
    private val clock = object : BootClock {
        override fun elapsedMs() = elapsed
        override fun boot() = boot
    }
    private val store = object : PinThrottle.Store {
        override var failures = 0
        override var lockedUntil = 0L
        override var lockedUntilElapsed = 0L
        override var lockedBoot = Int.MIN_VALUE
    }

    private fun throttle() = PinThrottle(store, clock) { wall }

    @Test
    fun `setting the clock forward does not end a PIN lockout`() {
        repeat(5) { throttle().onFailure() }
        wall += 2 * 3_600_000L
        assertThat(throttle().remainingMs()).isEqualTo(60_000)
        elapsed += 60_000
        assertThat(throttle().remainingMs()).isEqualTo(0)
    }

    @Test
    fun `setting the clock back does not stretch a PIN lockout`() {
        repeat(5) { throttle().onFailure() }
        wall -= 365L * 86_400_000
        assertThat(throttle().remainingMs()).isEqualTo(60_000)
    }

    @Test
    fun `after a reboot a clock set back stretches a PIN lockout to an hour at most`() {
        repeat(5) { throttle().onFailure() }
        boot++
        elapsed = 1_000
        wall -= 365L * 86_400_000
        assertThat(throttle().remainingMs()).isEqualTo(3_600_000)
    }

    @Test
    fun `a PIN lockout set before a reboot still runs on the wall clock`() {
        repeat(5) { throttle().onFailure() }
        boot++
        elapsed = 1_000
        assertThat(throttle().remainingMs()).isEqualTo(60_000)
    }

    @Test
    fun `a maintenance unlock ends on the boot-time clock even when the date is set back`() {
        val stored = MaintenanceWindow.Stored(wallEndMs = wall + 30 * 60_000, elapsedEndMs = elapsed + 30 * 60_000, boot = boot)
        assertThat(MaintenanceWindow.endsAtMs(stored, wall, clock)).isEqualTo(wall + 30 * 60_000)
        elapsed += 31 * 60_000
        wall -= 365L * 86_400_000
        assertThat(MaintenanceWindow.endsAtMs(stored, wall, clock)).isNull()
    }

    @Test
    fun `a maintenance unlock ends at a reboot`() {
        val stored = MaintenanceWindow.Stored(wallEndMs = wall + 30 * 60_000, elapsedEndMs = elapsed + 30 * 60_000, boot = boot)
        boot++
        elapsed = 1_000
        assertThat(MaintenanceWindow.endsAtMs(stored, wall, clock)).isNull()
    }

    @Test
    fun `a maintenance unlock from before the boot-time end existed uses the wall clock`() {
        val stored = MaintenanceWindow.Stored(wallEndMs = wall + 60_000, elapsedEndMs = null, boot = null)
        assertThat(MaintenanceWindow.endsAtMs(stored, wall, clock)).isEqualTo(wall + 60_000)
        assertThat(MaintenanceWindow.endsAtMs(stored, wall + 60_000, clock)).isNull()
    }

    @Test
    fun `the lock is not left open by a maintenance unlock whose boot-time end has passed`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 7)
        context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE).edit()
            // The date was set back a year after the unlock started, so the wall-clock end looks far away.
            .putLong("relock_at_wall", System.currentTimeMillis() + 365L * 86_400_000)
            .putLong("relock_at_elapsed", SystemClock.elapsedRealtime() - 1)
            .putInt("relock_boot", 7)
            .commit()
        assertThat(Lock.isInMaintenanceWindow(context)).isFalse()
    }
}
