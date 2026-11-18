// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.accounts.Account
import android.accounts.AccountManager
import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.os.Looper
import android.os.UserManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.test.core.app.ApplicationProvider
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import java.time.Duration
import java.time.LocalDate
import java.util.concurrent.TimeUnit
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.update.InstallLease
import org.plainphone.app.update.InstallWatchdogService
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class MaintenanceInstallTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = PlainphoneAdminReceiver.component(context)
    private val pkg = "org.example.approved"
    private val pin = "471159"

    private val service by lazy { Robolectric.buildService(InstallWatchdogService::class.java).create() }
    private var startId = 0

    @Before
    fun preparePhone() {
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
        shadowOf(context.getSystemService(PowerManager::class.java))
            .setIgnoringBatteryOptimizations(context.packageName, true)
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        dpm.addUserRestriction(admin, UserManager.DISALLOW_MODIFY_ACCOUNTS)
        shadowOf(AccountManager.get(context)).addAuthenticator("com.google")
        val salt = "0123456789abcdef"
        ConfigStore(context).save(PolicyConfig(pinHashHex = MaintenancePin.hash(pin, salt), pinSaltHex = salt))
        SyncStore(context).saveRules("test", rulesJson(toInstall = """[{"packageName":"$pkg","label":"Approved"}]"""), 0)
    }

    @After
    fun stopWatchdog() {
        if (startId > 0) service.destroy()
    }

    @Test
    fun `the correct PIN requests only Google sign-in and keeps accounts blocked`() {
        val activity = installPrompt()
        submit(activity, "111111")
        assertThat(message(activity).text.toString()).isEqualTo(activity.getString(R.string.maintenance_wrong_pin))
        assertThat(InstallWindow.current(context)).isNull()

        submit(activity, pin, expectAccountRequest = true)
        assertThat(activity.isFinishing).isFalse()
        assertThat(InstallWindow.current(context)).isEqualTo(pkg)
        assertThat(accountsBlocked()).isTrue()
        assertThat(shadowOf(activity).nextStartedActivity).isNull()

        val accounts = shadowOf(AccountManager.get(context))
        accounts.addAccount(Account("test", "com.google"))
        pumpUntil { activity.isFinishing }

        assertThat(activity.isFinishing).isTrue()
        assertThat(accountsBlocked()).isTrue()
        assertThat(shadowOf(activity).nextStartedActivity.data).isEqualTo(InstallWindow.playIntent(pkg).data)
    }

    @Test
    fun `late account completion cannot launch Play after the window closes`() {
        val activity = installPrompt()
        submit(activity, pin, expectAccountRequest = true)
        ShadowSystemClock.advanceBy(Duration.ofMillis(InstallWindow.WINDOW_MS))
        InstallLease.android(context).recover()

        shadowOf(AccountManager.get(context)).addAccount(Account("test", "com.google"))
        pumpUntil { activity.isFinishing }

        assertThat(activity.isFinishing).isTrue()
        assertThat(accountsBlocked()).isTrue()
        assertThat(shadowOf(activity).nextStartedActivity).isNull()
    }

    @Test
    fun `missing battery exemption has its own install error`() {
        shadowOf(context.getSystemService(PowerManager::class.java))
            .setIgnoringBatteryOptimizations(context.packageName, false)
        val activity = installPrompt()

        submit(activity, pin)

        assertThat(activity.isFinishing).isFalse()
        assertThat(message(activity).text.toString()).isEqualTo(activity.getString(R.string.maintenance_install_battery))
        assertThat(accountsBlocked()).isTrue()
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

    private fun submit(activity: MaintenanceActivity, entered: String, expectAccountRequest: Boolean = false) {
        val fields = fields(activity)
        (fields.getChildAt(1) as EditText).setText(entered)
        val button = fields.getChildAt(2) as Button
        button.performClick()
        fun done() = if (expectAccountRequest) {
            shadowOf(AccountManager.get(context)).peekNextAddAccountOptions() != null
        } else {
            activity.isFinishing || button.isEnabled
        }
        pumpUntil(::done)
        assertThat(done()).isTrue()
    }

    private fun pumpUntil(done: () -> Boolean) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (!done() && System.nanoTime() < deadline) {
            val intent = shadowOf(context as Application).nextStartedService
            if (intent?.component?.className == InstallWatchdogService::class.java.name) {
                service.get().onStartCommand(intent, 0, ++startId)
            }
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
    }

    private fun accountsBlocked() = context.getSystemService(UserManager::class.java).hasUserRestriction(UserManager.DISALLOW_MODIFY_ACCOUNTS)
}
