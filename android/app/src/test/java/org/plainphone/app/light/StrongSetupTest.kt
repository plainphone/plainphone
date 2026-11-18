// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.UserManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.MainActivity
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.provisioning.StrongSetup
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf

@RunWith(RobolectricTestRunner::class)
class StrongSetupTest {
    @Test fun dashboardDeviceOwnerWaitsForAudienceAndAccountBeforeLocking() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val manager = context.getSystemService(DevicePolicyManager::class.java)
        assertTrue(shadowOf(manager).setDeviceOwner(PlainphoneAdminReceiver.component(context)))
        StrongSetup.requireAccount(context)

        val intent = Intent(context, MainActivity::class.java).setAction(DevicePolicyManager.ACTION_PROVISIONING_SUCCESSFUL)
        Robolectric.buildActivity(MainActivity::class.java, intent).setup().use { controller ->
            val main = shadowOf(controller.get())
            val setup = checkNotNull(main.nextStartedActivityForResult)
            assertEquals(LightSetupActivity::class.java.name, setup.intent.component?.className)
            assertEquals(-1, setup.requestCode)
            assertNull(main.nextStartedActivityForResult)
        }
        assertEquals("setup", Lock.applyNow(context, "boot").single().name)
        Lock.recoverInstall(context, "startup")
        assertFalse(context.getSystemService(UserManager::class.java).hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS))

        LightSetup.saveProfile(context, "child")
        assertEquals("setup", Lock.applyNow(context, "account still pending").single().name)
        assertNull(Lock.firstAppliedAtMs(context))
    }
}
