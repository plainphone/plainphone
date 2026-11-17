// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.accounts.Account
import android.accounts.AccountManager
import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.Looper
import android.os.UserManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class MaintenanceInstallTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = PlainphoneAdminReceiver.component(context)
    private val pkg = "org.example.approved"
    private val pin = "471159"

    @Before
    fun preparePhone() {
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
        dpm.addUserRestriction(admin, UserManager.DISALLOW_MODIFY_ACCOUNTS)
        val salt = "0123456789abcdef"
        ConfigStore(context).save(PolicyConfig(pinHashHex = MaintenancePin.hash(pin, salt), pinSaltHex = salt))
        SyncStore(context).saveRules("test", rulesJson(toInstall = """[{"packageName":"$pkg","label":"Approved"}]"""), 0)
    }

    @Test
    fun `only the correct parent PIN lifts the account restriction for Play`() {
        val activity = installPrompt()
        submit(activity, "111111")
        assertThat(message(activity).text.toString()).isEqualTo(activity.getString(R.string.maintenance_wrong_pin))
        assertThat(InstallWindow.current(context)).isNull()
        assertThat(accountsBlocked()).isTrue()

        submit(activity, pin)
        assertThat(activity.isFinishing).isTrue()
        assertThat(InstallWindow.current(context)).isEqualTo(pkg)
        assertThat(accountsBlocked()).isFalse()
    }

    @Test
    fun `a Google account closes account changes while the app install stays open`() {
        submit(installPrompt(), pin)
        assertThat(accountsBlocked()).isFalse()

        val manager = AccountManager.get(context)
        assertThat(manager.addAccountExplicitly(Account("test", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()
        val deadline = System.nanoTime() + 5_000_000_000L
        while (!accountsBlocked() && System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }

        assertThat(accountsBlocked()).isTrue()
        assertThat(InstallWindow.current(context)).isEqualTo(pkg)
    }

    @Test
    @Config(application = Application::class)
    fun `replacing a Google account closes account changes even when the count stays the same`() {
        val manager = AccountManager.get(context)
        val old = Account("first", "com.google")
        assertThat(manager.addAccountExplicitly(old, null, null)).isTrue()
        assertThat(InstallWindow.openForParent(context, pkg)).isEqualTo(InstallWindow.OpenResult.OPENED)
        assertThat(InstallWindow.active(context)?.accountsAllowed).isTrue()

        assertThat(manager.removeAccountExplicitly(old)).isTrue()
        assertThat(manager.addAccountExplicitly(Account("second", "com.google"), null, null)).isTrue()
        assertThat(InstallWindow.active(context)?.accountsAllowed).isFalse()
    }

    @Test
    fun `exhausted quota keeps the PIN screen open and leaves accounts blocked`() {
        context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE).edit()
            .putString("day", LocalDate.now().toString()).putInt("windows", InstallWindow.MAX_PER_DAY).apply()
        val activity = installPrompt()

        submit(activity, pin)

        assertThat(activity.isFinishing).isFalse()
        assertThat(message(activity).text.toString()).isEqualTo(activity.getString(R.string.maintenance_install_limit))
        assertThat(InstallWindow.current(context)).isNull()
        assertThat(accountsBlocked()).isTrue()
        assertThat(shadowOf(context as android.app.Application).nextStartedActivity).isNull()
    }

    private fun installPrompt(): MaintenanceActivity = Robolectric.buildActivity(
        MaintenanceActivity::class.java,
        Intent(context, MaintenanceActivity::class.java).putExtra(MaintenanceActivity.EXTRA_INSTALL_PACKAGE, pkg),
    ).setup().get()

    private fun fields(activity: MaintenanceActivity) =
        activity.findViewById<android.widget.FrameLayout>(android.R.id.content)
            .getChildAt(0).let { (it as ScrollView).getChildAt(0) as LinearLayout }

    private fun message(activity: MaintenanceActivity) = fields(activity).getChildAt(3) as TextView

    private fun submit(activity: MaintenanceActivity, entered: String) {
        val fields = fields(activity)
        (fields.getChildAt(1) as EditText).setText(entered)
        val button = fields.getChildAt(2) as Button
        button.performClick()
        val deadline = System.nanoTime() + 5_000_000_000L
        while (!activity.isFinishing && !button.isEnabled && System.nanoTime() < deadline) {
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
        assertThat(activity.isFinishing || button.isEnabled).isTrue()
    }

    private fun accountsBlocked() = context.getSystemService(UserManager::class.java).hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)
}
