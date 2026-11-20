// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.UserManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PlainphoneAdminReceiver
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class ForceStopGuardTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = PlainphoneAdminReceiver.component(context)

    @Before
    fun deviceOwner() {
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
    }

    @Test
    fun `android 10 takes app controls away while a window is open`() {
        ForceStopGuard.set(context, true)
        assertThat(appsControlBlocked()).isTrue()

        ForceStopGuard.set(context, false)
        assertThat(appsControlBlocked()).isFalse()
    }

    @Test
    fun `android 11 and later leave app controls alone`() {
        ForceStopGuard.set(context, true, sdkInt = 30)

        assertThat(appsControlBlocked()).isFalse()
    }

    private fun appsControlBlocked() =
        context.getSystemService(UserManager::class.java).hasUserRestriction(UserManager.DISALLOW_APPS_CONTROL)
}
