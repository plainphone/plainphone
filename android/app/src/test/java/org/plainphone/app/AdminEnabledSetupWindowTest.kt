// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.util.concurrent.TimeUnit
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.provisioning.BootloaderWarning
import org.plainphone.app.ui.PairingActivity
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

/**
 * The emulator's Device Owner flow replays the admin-enabled broadcast that `am instrument`
 * cuts short (docs/testing.md). That broadcast alone must open the PIN-free pairing window.
 */
@RunWith(RobolectricTestRunner::class)
class AdminEnabledSetupWindowTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test
    fun `a new Device Owner pairs without the PIN only after the admin-enabled lock`() {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = PlainphoneAdminReceiver.component(context)
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
        val detect = BootloaderWarning.reportsUnlocked
        BootloaderWarning.reportsUnlocked = { false }
        try {
            // The state the emulator reached when the broadcast was killed: no lock, so no pairing screen.
            assertThat(Lock.firstAppliedAtMs(context)).isNull()
            assertThat(PairingActivity.canPairWithoutPin(context)).isFalse()

            PlainphoneAdminReceiver().onEnabled(context, Intent(DeviceAdminReceiver.ACTION_DEVICE_ADMIN_ENABLED))
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (Lock.firstAppliedAtMs(context) == null && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(5)
            }

            assertThat(Lock.firstAppliedAtMs(context)).isNotNull()
            assertThat(PairingActivity.canPairWithoutPin(context)).isTrue()
        } finally {
            BootloaderWarning.reportsUnlocked = detect
        }
    }
}
