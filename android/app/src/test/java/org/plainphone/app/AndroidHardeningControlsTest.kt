// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** The real DevicePolicyManager and broadcast calls behind [Hardening], against Robolectric. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class AndroidHardeningControlsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = PlainphoneAdminReceiver.component(context)

    @Before
    fun becomeDeviceOwner() {
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
    }

    private fun installPlayServices() {
        val app = ApplicationInfo().apply { packageName = AndroidHardeningControls.GMS_PACKAGE; enabled = true }
        shadowOf(context.packageManager).installPackage(PackageInfo().apply { packageName = app.packageName; applicationInfo = app })
    }

    @Test
    fun `Android 10 writes factoryResetProtectionAdmin for Play services and sends the broadcast`() {
        installPlayServices()
        val results = Hardening(AndroidHardeningControls(context), 29).apply(PolicyConfig(frpAccountIds = setOf("1234567890")))
        assertThat(results.single { it.name == Hardening.RESET_PROTECTION }.ok).isTrue()

        val bundle = dpm.getApplicationRestrictions(admin, AndroidHardeningControls.GMS_PACKAGE)
        assertThat(bundle.getStringArray(AndroidHardeningControls.KEY_FRP_ADMIN)).asList().containsExactly("1234567890")
        assertThat(bundle.getBoolean(AndroidHardeningControls.KEY_FRP_DISABLE, true)).isFalse()

        val sent = shadowOf(ApplicationProvider.getApplicationContext<android.app.Application>()).broadcastIntents
        val frp = sent.single { it.action == AndroidHardeningControls.ACTION_FRP_CONFIG_CHANGED }
        assertThat(frp.`package`).isEqualTo(AndroidHardeningControls.GMS_PACKAGE)
    }

    @Test
    fun `release switches the Android 10 configuration off`() {
        installPlayServices()
        val controls = AndroidHardeningControls(context)
        Hardening(controls, 29).apply(PolicyConfig(frpAccountIds = setOf("1234567890")))
        Hardening(controls, 29).release()
        val bundle = dpm.getApplicationRestrictions(admin, AndroidHardeningControls.GMS_PACKAGE)
        assertThat(bundle.containsKey(AndroidHardeningControls.KEY_FRP_ADMIN)).isFalse()
        assertThat(bundle.getBoolean(AndroidHardeningControls.KEY_FRP_DISABLE)).isTrue()
    }

    @Test
    fun `without Play services nothing is written`() {
        val results = Hardening(AndroidHardeningControls(context), 29).apply(PolicyConfig(frpAccountIds = setOf("1")))
        assertThat(Hardening.resetProtectionState(results)).isEqualTo(ResetProtection.NO_PLAY_SERVICES)
        assertThat(dpm.getApplicationRestrictions(admin, AndroidHardeningControls.GMS_PACKAGE).isEmpty).isTrue()
    }

    @Test
    fun `no extra users on a fresh phone`() {
        assertThat(AndroidHardeningControls(context).extraUsers()).isEmpty()
    }
}
