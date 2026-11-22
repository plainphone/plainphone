// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.Manifest
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowDevicePolicyManager

/**
 * Android re-posts its "admin allowed location" heads-up notification on every location grant,
 * and a tap on it opens the location permission page over Plainphone (seen in the API 34
 * emulator run, where it covered the SOS screen). A grant the policy already holds is not sent again.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [PermissionGrantsTest.CountingShadow::class])
class PermissionGrantsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val grants get() = Shadow.extract<CountingShadow>(dpm).grants

    @Before
    fun becomeDeviceOwner() {
        shadowOf(dpm).setActiveAdmin(PlainphoneAdminReceiver.component(context))
        assertThat(shadowOf(dpm).setDeviceOwner(PlainphoneAdminReceiver.component(context))).isTrue()
    }

    @Test
    fun `repeated policy applies grant the location permissions once`() {
        val controls = AndroidDeviceControls(context)
        val config = PolicyConfig.DEFAULT.copy(server = ServerOverlay(locationRequired = true))
        val applier = PolicyApplier(controls, MemoryHiddenStore(), 34)

        repeat(3) {
            assertThat(applier.apply(config).single { it.name == "location permission" }.ok).isTrue()
        }

        assertThat(grants.filter { it in LockPolicy.LOCATION_PERMISSIONS })
            .containsExactlyElementsIn(LockPolicy.LOCATION_PERMISSIONS)
        for (permission in LockPolicy.LOCATION_PERMISSIONS) {
            assertThat(dpm.getPermissionGrantState(PlainphoneAdminReceiver.component(context), context.packageName, permission))
                .isEqualTo(DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)
        }
    }

    @Test
    fun `hardening grants contacts once`() {
        val controls = AndroidHardeningControls(context)
        repeat(2) { assertThat(controls.grantOwnPermission(Manifest.permission.READ_CONTACTS)).isTrue() }
        assertThat(grants).containsExactly(Manifest.permission.READ_CONTACTS)
    }

    @Implements(DevicePolicyManager::class)
    class CountingShadow : ShadowDevicePolicyManager() {
        val grants = mutableListOf<String>()

        @Implementation
        override fun setPermissionGrantState(admin: ComponentName, packageName: String, permission: String, grantState: Int): Boolean {
            if (grantState == DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED) grants += permission
            return super.setPermissionGrantState(admin, packageName, permission, grantState)
        }
    }
}
