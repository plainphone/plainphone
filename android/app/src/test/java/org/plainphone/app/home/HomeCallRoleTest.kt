// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import android.app.Activity
import android.app.Application
import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import java.util.concurrent.TimeUnit
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Hardening
import org.plainphone.app.Lock
import org.plainphone.app.PlainphoneAdminReceiver
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30], application = Application::class)
class HomeCallRoleTest {
    @Test
    @Suppress("DEPRECATION") // Robolectric uses these helpers to simulate the Android 11 role controller.
    fun `strong mode home asks for call roles and reports acceptance`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val admin = PlainphoneAdminReceiver.component(context)
        val devicePolicy = shadowOf(context.getSystemService(DevicePolicyManager::class.java))
        devicePolicy.setActiveAdmin(admin)
        assertThat(devicePolicy.setDeviceOwner(admin)).isTrue()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val roles = context.getSystemService(RoleManager::class.java)
        val screening = Hardening.ROLE_CALL_SCREENING
        val redirection = Hardening.ROLE_CALL_REDIRECTION
        shadowOf(roles).addAvailableRole(screening)
        shadowOf(roles).addAvailableRole(redirection)
        Lock.applyNow(context, "before upgrade role consent")
        assertThat(Lock.lockState(context).callRoleActionNeeded).isTrue()

        val controller = Robolectric.buildActivity(HomeActivity::class.java).create().start().resume()
        try {
            val home = shadowOf(controller.get())
            val screeningRequest = home.nextStartedActivityForResult
            assertThat(screeningRequest?.intent?.getStringExtra("android.intent.extra.ROLE_NAME")).isEqualTo(screening)
            shadowOf(roles).addHeldRole(screening)
            home.receiveResult(screeningRequest.intent, Activity.RESULT_OK, null)

            val redirectionRequest = home.nextStartedActivityForResult
            assertThat(redirectionRequest?.intent?.getStringExtra("android.intent.extra.ROLE_NAME")).isEqualTo(redirection)
            shadowOf(roles).addHeldRole(redirection)
            home.receiveResult(redirectionRequest.intent, Activity.RESULT_OK, null)

            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
            while (Lock.lockState(context).callRoleActionNeeded && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(5)
            }
            val status = Lock.lockState(context)
            assertThat(status.callRoleActionNeeded).isFalse()
            assertThat(status.failedPolicies).containsNoneOf(Hardening.CALL_SCREENING_ROLE, Hardening.CALL_REDIRECTION_ROLE)
            assertThat(home.nextStartedActivityForResult).isNull()
        } finally {
            controller.pause().stop().destroy()
        }
    }
}
