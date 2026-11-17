// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.UserManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.provisioning.BootloaderWarning
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 30])
class BootloaderPolicyTest {
    @Test
    fun `the strong lock entry point waits for acknowledgment before adding restrictions`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = PlainphoneAdminReceiver.component(context)
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()

        val detect = BootloaderWarning.reportsUnlocked
        BootloaderWarning.reportsUnlocked = { true }
        try {
            val result = Lock.applyNow(context, "admin enabled")
            assertThat(result.single().name).isEqualTo("bootloader warning")
            assertThat(result.single().ok).isFalse()
            val users = context.getSystemService(UserManager::class.java)
            assertThat(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)).isFalse()
            assertThat(Lock.firstAppliedAtMs(context)).isNull()

            BootloaderWarning.acknowledge(context)
            Lock.applyNow(context, "warning acknowledged")
            assertThat(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)).isTrue()
        } finally {
            BootloaderWarning.reportsUnlocked = detect
        }
    }
}
