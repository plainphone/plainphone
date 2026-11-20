// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.provider.MediaStore
import android.provider.Telephony
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** Core apps are never hidden or limited, so a filter any app can declare must not make an app core. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class CorePackagesTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    private fun installCamera(pkg: String, system: Boolean) {
        val pm = shadowOf(context.packageManager)
        val app = ApplicationInfo().apply {
            packageName = pkg
            if (system) flags = ApplicationInfo.FLAG_SYSTEM
        }
        pm.installPackage(PackageInfo().apply { packageName = pkg; applicationInfo = app })
        val activity = ComponentName(pkg, "$pkg.Capture")
        pm.addActivityIfNotPresent(activity)
        pm.addIntentFilterForActivity(
            activity,
            IntentFilter(MediaStore.ACTION_IMAGE_CAPTURE).apply { addCategory(Intent.CATEGORY_DEFAULT) },
        )
    }

    private fun installSmsApp(pkg: String, system: Boolean) {
        val pm = shadowOf(context.packageManager)
        val app = ApplicationInfo().apply {
            packageName = pkg
            if (system) flags = ApplicationInfo.FLAG_SYSTEM
        }
        pm.installPackage(PackageInfo().apply { packageName = pkg; applicationInfo = app })
        val receiver = ComponentName(pkg, "$pkg.SmsReceiver")
        pm.addReceiverIfNotPresent(receiver)
        pm.addIntentFilterForReceiver(receiver, IntentFilter(Telephony.Sms.Intents.SMS_DELIVER_ACTION))
    }

    @Test
    fun `an SMS app from Play is not core and is hidden while Plainphone holds the SMS role`() {
        installSmsApp("com.example.playsms", system = false)
        installSmsApp("com.example.messages", system = true)
        val controls = AndroidDeviceControls(context)
        val core = controls.corePackages(emptySet())
        assertThat(core).contains("com.example.messages")
        assertThat(core).doesNotContain("com.example.playsms")
        val apps = controls.telephonyApps()
        assertThat(apps.systemSmsApps).containsExactly("com.example.messages")
        val hide = LockPolicy.telephonyAppsToHide(apps, context.packageName, holdsDialer = false, holdsSms = true)
        assertThat(hide).containsAtLeast("com.example.playsms", "com.example.messages")
    }

    @Test
    fun `a sideloaded app with a camera filter is not core, the phone's camera is`() {
        installCamera("com.example.sideloaded", system = false)
        installCamera("com.example.camera", system = true)
        val core = AndroidDeviceControls(context).corePackages(emptySet())
        assertThat(core).contains("com.example.camera")
        assertThat(core).doesNotContain("com.example.sideloaded")
        assertThat(core).contains(context.packageName)
    }
}
