// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.update

import android.app.Activity
import android.app.Application
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.os.Looper
import android.os.PowerManager
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import androidx.work.testing.WorkManagerTestInitHelper
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.MainActivity
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.R
import org.plainphone.app.provisioning.BootloaderWarning
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], application = Application::class)
class UpdateBatteryExemptionTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()

    private fun becomeOwner() {
        val admin = PlainphoneAdminReceiver.component(context)
        val dpm = shadowOf(context.getSystemService(DevicePolicyManager::class.java))
        dpm.setActiveAdmin(admin)
        assertTrue(dpm.setDeviceOwner(admin))
    }

    @Test fun setupRequestsTheSystemDialogOnlyWhenStrongAndMissing() {
        assertNull(UpdateBatteryExemption.setupRequest(context))
        becomeOwner()
        val intent = UpdateBatteryExemption.setupRequest(context)!!
        assertEquals(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, intent.action)
        assertEquals("package:${context.packageName}", intent.dataString)
        grantExemption()
        assertNull(UpdateBatteryExemption.setupRequest(context))
    }

    @Test fun decliningInSetupPromptsAgainOnNextVisit() {
        becomeOwner()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val detect = BootloaderWarning.reportsUnlocked
        BootloaderWarning.reportsUnlocked = { false }
        val controller = Robolectric.buildActivity(MainActivity::class.java).setup()
        try {
            val activity = controller.get()
            awaitBatteryPrompt().getButton(android.content.DialogInterface.BUTTON_POSITIVE).performClick()
            shadowOf(Looper.getMainLooper()).idle()
            val request = shadowOf(activity).nextStartedActivityForResult
            assertEquals(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, request?.intent?.action)

            controller.pause().stop()
            shadowOf(activity).receiveResult(request.intent, Activity.RESULT_CANCELED, null)
            controller.restart().start().resume()
            waitForPolicyApply()
            assertFalse(ShadowAlertDialog.getLatestAlertDialog().isShowing)

            controller.pause().stop().restart().start().resume()
            assertTrue(awaitBatteryPrompt().isShowing)
        } finally {
            controller.pause().stop().destroy()
            BootloaderWarning.reportsUnlocked = detect
        }
    }

    private fun awaitBatteryPrompt(): android.app.AlertDialog {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        do {
            shadowOf(Looper.getMainLooper()).idle()
            val dialog = ShadowAlertDialog.getLatestAlertDialog()
            if (dialog?.isShowing == true) {
                assertEquals(context.getString(R.string.update_battery_required), shadowOf(dialog).title)
                return dialog
            }
            Thread.sleep(5)
        } while (System.nanoTime() < deadline)
        error("Battery setup prompt did not appear")
    }

    private fun waitForPolicyApply() {
        val applied = java.util.concurrent.CountDownLatch(1)
        Lock.applyAsync(context, "test barrier") { applied.countDown() }
        assertTrue(applied.await(5, TimeUnit.SECONDS))
        shadowOf(Looper.getMainLooper()).idle()
    }

    @Test fun statusTracksTheCurrentExemption() {
        assertTrue(Lock.lockState(context).failedPolicies.isEmpty())
        becomeOwner()
        val failure = "battery exemption missing: self-update cannot run"
        assertTrue(Lock.lockState(context).failedPolicies.contains(failure))
        grantExemption()
        assertTrue(Lock.lockState(context).failedPolicies.isEmpty())
    }

    @Test fun forcedUpdateReportsTheMissingExemptionAndPostsTheSystemDialog() {
        becomeOwner()
        val outcome = SelfUpdate.updater(context).run(force = true)
        val report = SelfUpdate.report(context)!!
        assertEquals(UpdateErrorCode.BATTERY_EXEMPTION_MISSING, report.errorCode)
        assertEquals("Allow Plainphone to run in the background so it can update itself safely.", report.detail)
        assertEquals(SelfUpdater.Outcome.Failed(report.detail!!), outcome)
        val notifications = shadowOf(context.getSystemService(NotificationManager::class.java))
        val intent = shadowOf(notifications.allNotifications.single().contentIntent).savedIntent
        assertEquals(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, intent.action)
        assertEquals("package:${context.packageName}", intent.dataString)
        grantExemption()
        assertNull(SelfUpdate.report(context))
        assertTrue(notifications.allNotifications.isEmpty())
    }

    private fun grantExemption() {
        shadowOf(context.getSystemService(PowerManager::class.java))
            .setIgnoringBatteryOptimizations(context.packageName, true)
    }
}
