// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.app.Activity
import android.content.DialogInterface
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Looper
import android.os.UserManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.MainActivity
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.provisioning.PolicyComplianceActivity
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
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

    @Test fun provisioningAppliesRestrictionsBeforeReturningSuccess() {
        Robolectric.buildActivity(PolicyComplianceActivity::class.java).setup().use { controller ->
            val activity = controller.get()
            val deadline = System.nanoTime() + 5_000_000_000L
            while (!activity.isFinishing && System.nanoTime() < deadline) {
                shadowOf(Looper.getMainLooper()).idle()
                Thread.sleep(10)
            }
            assertTrue(activity.isFinishing)
            assertEquals(Activity.RESULT_OK, shadowOf(activity).resultCode)
            assertTrue(users.hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS))
        }
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
