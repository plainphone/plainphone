// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.ActivityInfo
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.ResolveInfo
import android.os.UserManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Runs the real DevicePolicyManager calls against Robolectric's shadow. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class AndroidDeviceControlsTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)

    @Before
    fun becomeDeviceOwner() {
        shadowOf(dpm).setActiveAdmin(PlainphoneAdminReceiver.component(context))
        assertThat(shadowOf(dpm).setDeviceOwner(PlainphoneAdminReceiver.component(context))).isTrue()
        installLaunchable("com.zhiliaoapp.musically")
        installLaunchable("com.android.chrome")
    }

    @Test
    fun `restrictions and hidden apps land in DevicePolicyManager`() {
        val controls = AndroidDeviceControls(context)
        assertThat(controls.isDeviceOwner()).isTrue()

        val results = PolicyApplier(controls, MemoryHiddenStore(), 35).apply(PolicyConfig.DEFAULT)

        // Robolectric records DPM restrictions in UserManager, like the real system does.
        val um = context.getSystemService(UserManager::class.java)
        assertThat(um.hasUserRestriction(UserManager.DISALLOW_FACTORY_RESET)).isTrue()
        assertThat(um.hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)).isTrue()
        assertThat(um.hasUserRestriction(UserManager.DISALLOW_CONFIG_PRIVATE_DNS)).isTrue()
        assertThat(um.hasUserRestriction(UserManager.DISALLOW_SAFE_BOOT)).isTrue()
        assertThat(dpm.isApplicationHidden(PlainphoneAdminReceiver.component(context), "com.zhiliaoapp.musically")).isTrue()
        assertThat(dpm.isApplicationHidden(PlainphoneAdminReceiver.component(context), "com.android.chrome")).isFalse()
        assertThat(results.single { it.name.startsWith("hide apps") }.ok).isTrue()
        assertThat(results.filter { it.name.startsWith("restriction") }.all { it.ok }).isTrue()
    }

    @Suppress("DEPRECATION") // addResolveInfoForIntent is the simplest way to fake a launcher icon.
    private fun installLaunchable(pkg: String) {
        val app = ApplicationInfo().apply { packageName = pkg }
        shadowOf(context.packageManager).installPackage(PackageInfo().apply { packageName = pkg; applicationInfo = app })
        val info = ResolveInfo().apply {
            activityInfo = ActivityInfo().apply { packageName = pkg; name = "$pkg.Main"; applicationInfo = app }
        }
        shadowOf(context.packageManager).addResolveInfoForIntent(
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER),
            info,
        )
    }
}
