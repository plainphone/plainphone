// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.app.Activity
import android.content.DialogInterface
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import android.os.PersistableBundle
import android.os.PowerManager
import android.os.UserManager
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import androidx.work.NetworkType
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.MainActivity
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.PolicyConfig
import org.plainphone.app.provisioning.PolicyComplianceActivity
import org.plainphone.app.sync.EnrollWorker
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.KeystoreSecretBox
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowAlertDialog

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class StrongSetupTest {
    private val context get() = ApplicationProvider.getApplicationContext<Context>()
    private val users get() = context.getSystemService(UserManager::class.java)

    @Before fun setDeviceOwner() {
        val manager = context.getSystemService(DevicePolicyManager::class.java)
        val admin = PlainphoneAdminReceiver.component(context)
        shadowOf(manager).setActiveAdmin(admin)
        assertTrue(shadowOf(manager).setDeviceOwner(admin))
    }

    @Test
    @Config(shadows = [EnrollmentSecretBox::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun provisioningAppliesRestrictionsAndSchedulesQrEnrollmentBeforeReturningSuccess() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val token = "pp_e_test-enrollment"
        val intent = Intent(context, PolicyComplianceActivity::class.java).putExtra(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
            PersistableBundle().apply { putString(PolicyConfig.KEY_ENROLL, token) },
        )
        Robolectric.buildActivity(PolicyComplianceActivity::class.java, intent).setup().use { controller ->
            val activity = controller.get()
            val deadline = System.nanoTime() + 5_000_000_000L
            while (ShadowAlertDialog.getLatestAlertDialog()?.isShowing != true &&
                !activity.isFinishing && System.nanoTime() < deadline
            ) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            assertTrue(!activity.isFinishing)
            ShadowAlertDialog.getLatestAlertDialog().getButton(DialogInterface.BUTTON_POSITIVE).performClick()
            shadowOf(Looper.getMainLooper()).idle()
            val request = shadowOf(activity).nextStartedActivityForResult
            assertEquals(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, request?.intent?.action)
            assertTrue(!activity.isFinishing)
            shadowOf(activity).receiveResult(request.intent, Activity.RESULT_CANCELED, null)

            while (!activity.isFinishing && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            assertTrue(activity.isFinishing)
            assertEquals(Activity.RESULT_OK, shadowOf(activity).resultCode)
            assertTrue(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS))
            assertEquals(token, SyncStore(context).enrollToken())
            val work = WorkManager.getInstance(context)
                .getWorkInfosByTag(EnrollWorker::class.java.name).get(5, TimeUnit.SECONDS).single()
            assertEquals(WorkInfo.State.ENQUEUED, work.state)
            assertEquals(NetworkType.CONNECTED, work.constraints.requiredNetworkType)
        }
    }

    @Implements(KeystoreSecretBox::class)
    class EnrollmentSecretBox {
        private val box = FakeSecretBox()

        @Implementation fun seal(plain: String): String = box.seal(plain)
        @Implementation fun open(sealed: String): String? = box.open(sealed)
    }

    @Test fun existingDeviceOwnerOpensNormallyWithoutAnOnboardingProfile() {
        context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE).edit()
            .putLong("first_applied_at", 1L).apply()
        SyncStore(context, FakeSecretBox()).savePaired("existing", "pp_d_test")

        Robolectric.buildActivity(MainActivity::class.java).setup().use { controller ->
            assertNull(shadowOf(controller.get()).nextStartedActivity)
            assertNull(ShadowAlertDialog.getLatestAlertDialog())
        }
        assertNull(LightSetup.profile(context))
        assertEquals(1L, Lock.firstAppliedAtMs(context))
    }

    @Test fun enrollmentFinishingAfterLaunchShowsTheAccountOnce() {
        shadowOf(context.getSystemService(PowerManager::class.java))
            .setIgnoringBatteryOptimizations(context.packageName, true)
        Robolectric.buildActivity(MainActivity::class.java).setup().use {
            val store = SyncStore(context, FakeSecretBox())
            store.savePaired("new", "pp_d_test", PlainphoneApi.PollAccount("p***@example.org", "Family"))
            shadowOf(Looper.getMainLooper()).idle()

            val dialog = checkNotNull(ShadowAlertDialog.getLatestAlertDialog())
            assertTrue(dialog.isShowing)
            assertEquals("Connected to p***@example.org (Family)", shadowOf(dialog).title.toString())
            dialog.getButton(DialogInterface.BUTTON_POSITIVE).performClick()
            shadowOf(Looper.getMainLooper()).idle()
            assertNull(store.enrollmentAccount())
        }
    }
}
