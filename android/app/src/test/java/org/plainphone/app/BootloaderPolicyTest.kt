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
    fun `the strong lock entry point reports the warning before adding restrictions`() = withOwner { context, users ->
        BootloaderWarning.reportsUnlocked = { true }
        val result = Lock.applyNow(context, "admin enabled")
        assertThat(result.single().name).isEqualTo("bootloader warning")
        assertThat(result.single().ok).isFalse()
        assertThat(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)).isFalse()
        assertThat(Lock.firstAppliedAtMs(context)).isNull()
        assertThat(Lock.lockState(context).failedPolicies).containsExactly("bootloader warning", "battery exemption missing: self-update cannot run")
        assertThat(Lock.lockState(context).intact).isFalse()

        BootloaderWarning.acknowledge(context)
        Lock.applyIfNeeded(context, "warning acknowledged", maxAgeMs = 60_000)
        assertThat(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)).isTrue()
        assertThat(Lock.lockState(context).failedPolicies).doesNotContain("bootloader warning")
    }

    @Test
    fun `maintenance relocks an enrolled phone even without acknowledgment`() = withOwner { context, users ->
        BootloaderWarning.reportsUnlocked = { false }
        Lock.applyNow(context, "initial lock")
        assertThat(Lock.firstAppliedAtMs(context)).isNotNull()
        Lock.applier(context).lift()
        assertThat(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)).isFalse()
        context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE).edit()
            .putLong("relock_at_wall", System.currentTimeMillis() + 60_000).commit()

        BootloaderWarning.reportsUnlocked = { true }
        Lock.applyNow(context, "maintenance expired")

        assertThat(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)).isTrue()
        assertThat(Lock.lockState(context).maintenance).isFalse()
        assertThat(Lock.lockState(context).failedPolicies).doesNotContain("bootloader warning")
    }

    @Test
    @Config(sdk = [31, 34])
    fun `Android 12 and newer lock without acknowledgment`() = withOwner { context, users ->
        BootloaderWarning.reportsUnlocked = { true }

        Lock.applyNow(context, "initial lock")

        assertThat(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)).isTrue()
        assertThat(Lock.firstAppliedAtMs(context)).isNotNull()
    }

    private fun withOwner(block: (Context, UserManager) -> Unit) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = PlainphoneAdminReceiver.component(context)
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
        val detect = BootloaderWarning.reportsUnlocked
        try {
            block(context, context.getSystemService(UserManager::class.java))
        } finally {
            BootloaderWarning.reportsUnlocked = detect
        }
    }
}
