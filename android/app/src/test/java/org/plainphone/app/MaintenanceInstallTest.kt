// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.accounts.Account
import android.accounts.AccountManager
import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.PowerManager
import android.os.SystemClock
import android.os.Looper
import android.os.UserManager
import android.view.View
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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.json.JSONArray
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.catalog.ApprovedAccounts
import org.plainphone.app.catalog.CatalogAccounts
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.sync.LiftedPolicy
import org.plainphone.app.sync.StatusNotices
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.update.InstallLease
import org.plainphone.app.update.InstallWatchdogService
import org.plainphone.app.update.UpdateReceiver
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowAlarmManager
import org.robolectric.shadows.ShadowDevicePolicyManager
import org.robolectric.shadow.api.Shadow
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
        assertThat(fallback(activity).visibility).isEqualTo(View.GONE)

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
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
        assertThat(AccountManager.get(context).getAccountsByType("com.google")).hasLength(1)
    }

    @Test
    fun `only failed sign-in offers fallback and a failed retry relocks without charging quota`() {
        val accounts = shadowOf(AccountManager.get(context))
        val activity = installPrompt()
        assertThat(fallback(activity).visibility).isEqualTo(View.GONE)

        submit(activity, pin, expectAccountRequest = true)
        assertThat(fallback(activity).visibility).isEqualTo(View.GONE)
        completeWithoutGoogleAccount()
        pumpUntil { fallback(activity).visibility == View.VISIBLE }
        assertThat(fallback(activity).visibility).isEqualTo(View.VISIBLE)
        assertThat(accountsBlocked()).isTrue()

        fallback(activity).performClick()
        pumpUntil { !accountsBlocked() }
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(accountsBlocked()).isFalse()
        accounts.setAuthenticationErrorOnNextResponse(true)
        completeWithoutGoogleAccount()
        pumpUntil { accountsBlocked() }
        assertThat(accountsBlocked()).isTrue()
        assertThat(InstallWindow.current(context)).isEqualTo(pkg)
        assertThat(context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE)
            .getInt("windows", 0)).isEqualTo(1)
    }

    @Test
    fun `account updates relock before the authenticator returns a result`() {
        startFallback()
        val accountManager = AccountManager.get(context)
        assertThat(accountManager.addAccountExplicitly(Account("test", "com.google"), null, null)).isTrue()
        pumpUntil { accountsBlocked() }
        assertThat(accountsBlocked()).isTrue()
        assertThat(InstallWindow.current(context)).isEqualTo(pkg)
    }

    @Test
    fun `removing an account during fallback relocks and warns`() {
        val manager = AccountManager.get(context)
        val existing = Account("parent", "com.google")
        preexisting(existing)
        startFallback()

        assertThat(manager.removeAccountExplicitly(existing)).isTrue()
        pumpUntil { accountsBlocked() }

        assertThat(accountsBlocked()).isTrue()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `adding a non Google account during fallback relocks and warns`() {
        startFallback()
        val manager = AccountManager.get(context)
        assertThat(manager.addAccountExplicitly(Account("other", "org.example"), null, null)).isTrue()
        pumpUntil { accountsBlocked() }

        assertThat(accountsBlocked()).isTrue()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    @Config(shadows = [AccountRelockShadow::class])
    fun `authenticator completion detects a removal before the restriction returns`() {
        val manager = AccountManager.get(context)
        val existing = Account("parent", "com.google")
        preexisting(existing)
        startFallback()
        val markers = context.getSharedPreferences("plainphone_catalog_accounts", Context.MODE_PRIVATE)
        val (id, encoded) = markers.all.entries.single()
        val marker = JSONArray(encoded as String)
        val baseline = marker.getJSONArray(1)
        val request = CatalogAccounts.Request(
            id, marker.getString(2), pkg, (0 until baseline.length()).map(baseline::getString).toSet(), true,
        )
        val listeners = shadowOf(manager).listeners
        val registered = listeners.toMap()
        Shadow.extract<AccountRelockShadow>(dpm).beforeAccountRelock = {
            // Android delivers the notification asynchronously; the shadow delivers it inline.
            listeners.clear()
            try {
                assertThat(manager.removeAccountExplicitly(existing)).isTrue()
            } finally {
                listeners.putAll(registered)
            }
        }

        assertThat(CatalogAccounts.complete(context, request)).isFalse()

        assertThat(accountsBlocked()).isTrue()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `expired fallback does not warn for a subsequent maintenance account removal`() {
        val manager = AccountManager.get(context)
        val existing = Account("parent", "com.google")
        preexisting(existing)
        startFallback()
        ShadowSystemClock.advanceBy(Duration.ofMinutes(3))
        InstallLease.android(context).recover()
        assertThat(accountsBlocked()).isTrue()

        val lifted = CountDownLatch(1)
        Lock.liftAsync(context) { lifted.countDown() }
        pumpUntil { lifted.count == 0L }
        assertThat(accountsBlocked()).isFalse()
        assertThat(manager.removeAccountExplicitly(existing)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
    }

    @Test
    fun `account listener warns about a new Google account after fallback expiry`() {
        expireFallback()

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `completion warns about a new Google account before the account listener runs`() {
        val request = expireFallback()
        val manager = AccountManager.get(context)
        // Model delivery of the callback before Android dispatches the account update.
        val listeners = shadowOf(manager).listeners
        val registered = listeners.toMap()
        listeners.clear()
        try {
            assertThat(manager.addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
            assertThat(CatalogAccounts.complete(context, request)).isFalse()
        } finally {
            listeners.putAll(registered)
        }

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `a new approved sign-in supersedes an expired fallback`() {
        val expired = expireFallback()
        val retry = checkNotNull(CatalogAccounts.start(context, pkg))

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("retry", "com.google"), null, null)).isTrue()
        assertThat(CatalogAccounts.complete(context, expired)).isFalse()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(CatalogAccounts.complete(context, retry)).isTrue()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
    }

    @Test
    fun `a new approved sign-in reports a late addition already in its baseline`() {
        expireFallback()
        val manager = AccountManager.get(context)
        val listeners = shadowOf(manager).listeners
        val registered = listeners.toMap()
        listeners.clear()
        try {
            assertThat(manager.addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
            checkNotNull(CatalogAccounts.start(context, pkg))
        } finally {
            listeners.putAll(registered)
        }

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `a cancelled approved sign-in does not end tracking of an expired fallback`() {
        expireFallback()
        val retry = checkNotNull(CatalogAccounts.start(context, pkg))
        assertThat(CatalogAccounts.complete(context, retry)).isFalse()

        // The fallback's login was left open and finishes now.
        assertThat(AccountManager.get(context).addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `a second fallback does not report its own account as late for an expired one`() {
        expireFallback()
        // A second fallback is open (its outcome is not recorded yet) next to the expired first one.
        val prefs = context.getSharedPreferences("plainphone_catalog_accounts", Context.MODE_PRIVATE)
        val first = JSONArray(prefs.all.values.single() as String)
        val second = JSONArray(first.toString()).put(6, org.json.JSONObject.NULL).put(7, org.json.JSONObject.NULL)
        prefs.edit().putString("second-fallback", second.toString()).commit()

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("parent", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
    }

    @Test
    fun `an open sign-in keeps tracking across a maintenance unlock`() {
        submit(installPrompt(), pin, expectAccountRequest = true)
        val lifted = CountDownLatch(1)
        Lock.liftAsync(context) { lifted.countDown() }
        pumpUntil { lifted.count == 0L }
        relockAfterUnlock()
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()

        // The window closes and the login left open before the unlock finishes afterwards.
        InstallWindow.close(context, "test window end", pkg)
        assertThat(AccountManager.get(context).addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `account listener warns about a new non Google account after fallback expiry`() {
        expireFallback()

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("other", "org.example"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `a Google account added during maintenance unlock after fallback expiry does not warn`() {
        expireFallback()
        val lifted = CountDownLatch(1)
        Lock.liftAsync(context) { lifted.countDown() }
        pumpUntil { lifted.count == 0L }

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("parent", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()

        // The same account is not reported once the unlock has ended either.
        relockAfterUnlock()
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
    }

    @Test
    fun `an unlock account added while no listener ran is absorbed when the unlock ends`() {
        val expired = expireFallback()
        val lifted = CountDownLatch(1)
        Lock.liftAsync(context) { lifted.countDown() }
        pumpUntil { lifted.count == 0L }
        val manager = AccountManager.get(context)
        val listeners = shadowOf(manager).listeners
        val registered = listeners.toMap()
        listeners.clear() // the process was dead while the parents added the account
        try {
            assertThat(manager.addAccountExplicitly(Account("parent", "com.google"), null, null)).isTrue()
        } finally {
            listeners.putAll(registered)
        }
        relockAfterUnlock()

        assertThat(CatalogAccounts.complete(context, expired)).isFalse()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
    }

    @Test
    fun `a wall clock correction does not drop a login marker within the same boot`() {
        android.provider.Settings.Global.putInt(context.contentResolver, android.provider.Settings.Global.BOOT_COUNT, 7)
        expireFallback()
        val markers = context.getSharedPreferences("plainphone_catalog_accounts", Context.MODE_PRIVATE)
        val (id, encoded) = markers.all.entries.single()
        val marker = JSONArray(encoded as String)
        marker.put(3, System.currentTimeMillis() - 1_000) // the wall clock was corrected forwards
        markers.edit().putString(id, marker.toString()).commit()

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `a withdrawn release locks accounts again at the next apply`() {
        startFallback()
        Lock.applyIfNeeded(context, "seed", 0)
        context.getSharedPreferences(SyncStore.PREFS, Context.MODE_PRIVATE).edit()
            .putString("phone_id", "7f1c2b9e-0000-4000-8000-000000000001").commit()
        val rules = { release: Boolean -> SyncStore(context).saveRules("r", rulesJson(release = release), 0) }
        rules(true)
        InstallWindow.close(context, "test close", pkg)
        pumpUntil { InstallWindow.current(context) == null }
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(accountsBlocked()).isFalse()

        rules(false)
        Lock.applyIfNeeded(context, "release withdrawn", Long.MAX_VALUE)

        assertThat(accountsBlocked()).isTrue()
    }

    @Test
    @Config(shadows = [AccountRelockShadow::class])
    fun `a fallback start folds an account added while it is open instead of reporting it`() {
        val expired = expireFallback()
        val manager = AccountManager.get(context)
        // An account appears after start() took its account snapshot, while the restriction is lifted. Android
        // delivers the account notification asynchronously, so it has not been seen when start() goes on.
        val listeners = shadowOf(manager).listeners
        val registered = listeners.toMap()
        Shadow.extract<AccountRelockShadow>(dpm).afterAccountClear = {
            listeners.clear()
            try {
                assertThat(manager.addAccountExplicitly(Account("parent", "com.google"), null, null)).isTrue()
            } finally {
                listeners.putAll(registered)
            }
        }

        // The lease is armed off the main thread, as MaintenanceActivity does.
        var second: CatalogAccounts.Request? = null
        var failure: Throwable? = null
        Thread {
            try {
                val fallbackId = InstallLease.android(context)
                    .armCatalogAccounts(expired.leaseId, SystemClock.elapsedRealtime() + CatalogAccounts.FALLBACK_MS)
                second = CatalogAccounts.start(context, pkg, expired.leaseId, fallbackId)
            } catch (e: Throwable) {
                failure = e
            }
        }.also { it.start(); pumpUntil { !it.isAlive } }
        failure?.let { throw it }

        val prefs = context.getSharedPreferences("plainphone_catalog_accounts", Context.MODE_PRIVATE)
        val relocked = checkNotNull(JSONArray(prefs.getString(expired.id, null)).optJSONArray(7))
        assertThat(relocked.length()).isEqualTo(manager.accounts.size)
        assertThat(manager.getAccountsByType("com.google")).hasLength(1)
        assertThat(checkNotNull(second).fallback).isTrue()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
    }

    @Test
    fun `a fallback start reports an account added after the relock snapshot but before start`() {
        val expired = expireFallback()
        val manager = AccountManager.get(context)
        val listeners = shadowOf(manager).listeners
        val registered = listeners.toMap()
        listeners.clear()
        try {
            assertThat(manager.addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        } finally {
            listeners.putAll(registered)
        }

        var failure: Throwable? = null
        Thread {
            try {
                val fallbackId = InstallLease.android(context)
                    .armCatalogAccounts(expired.leaseId, SystemClock.elapsedRealtime() + CatalogAccounts.FALLBACK_MS)
                CatalogAccounts.start(context, pkg, expired.leaseId, fallbackId)
            } catch (e: Throwable) {
                failure = e
            }
        }.also { it.start(); pumpUntil { !it.isAlive } }
        failure?.let { throw it }

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `a marker from before the relock snapshot treats any new account as late`() {
        val expired = expireFallback()
        stripRelockSnapshot(expired.id, outcome = false)

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `a marker from before the relock snapshot still accepts the one expected Google account`() {
        val expired = expireFallback()
        stripRelockSnapshot(expired.id, outcome = true)

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("parent", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    /** Rewrites a settled fallback marker the way an older app version stored it: outcome, no relock set (index 7). */
    private fun stripRelockSnapshot(id: String, outcome: Boolean) {
        val prefs = context.getSharedPreferences("plainphone_catalog_accounts", Context.MODE_PRIVATE)
        val marker = JSONArray(prefs.getString(id, null))
        val older = JSONArray()
        (0..5).forEach { older.put(marker.get(it)) }
        older.put(outcome)
        assertThat(prefs.edit().putString(id, older.toString()).commit()).isTrue()
    }

    private fun relockAfterUnlock() {
        val done = CountDownLatch(1)
        Lock.applyAsync(context, "unlock ended") { done.countDown() }
        pumpUntil { done.count == 0L }
        shadowOf(Looper.getMainLooper()).idle()
    }

    private fun expireFallback(): CatalogAccounts.Request {
        startFallback()
        val markers = context.getSharedPreferences("plainphone_catalog_accounts", Context.MODE_PRIVATE)
        val (id, encoded) = markers.all.entries.single()
        val marker = JSONArray(encoded as String)
        val baseline = marker.getJSONArray(1)
        val request = CatalogAccounts.Request(
            id, marker.getString(2), pkg, (0 until baseline.length()).map(baseline::getString).toSet(), true,
        )
        ShadowSystemClock.advanceBy(Duration.ofMinutes(3))
        InstallLease.android(context).recover()
        assertThat(accountsBlocked()).isTrue()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
        return request
    }

    @Implements(DevicePolicyManager::class)
    class AccountRelockShadow : ShadowDevicePolicyManager() {
        var beforeAccountRelock: (() -> Unit)? = null
        var afterAccountClear: (() -> Unit)? = null

        @Implementation
        override fun clearUserRestriction(admin: ComponentName, key: String) {
            super.clearUserRestriction(admin, key)
            if (key == UserManager.DISALLOW_MODIFY_ACCOUNTS) {
                val action = afterAccountClear
                afterAccountClear = null
                action?.invoke()
            }
        }

        @Implementation
        override fun addUserRestriction(admin: ComponentName, restriction: String) {
            if (restriction == UserManager.DISALLOW_MODIFY_ACCOUNTS) {
                val action = beforeAccountRelock
                beforeAccountRelock = null
                action?.invoke()
            }
            super.addUserRestriction(admin, restriction)
        }
    }

    @Test
    fun `fallback deadline relocks accounts while catalog stays open`() {
        var tappedAt = 0L
        startFallback { tappedAt = SystemClock.elapsedRealtime() }
        UpdateReceiver.cancelLeaseExpiry(context, InstallLease.CATALOG_ACCOUNTS)
        val prefs = context.getSharedPreferences("plainphone_install_lease", Context.MODE_PRIVATE)
        val marker = checkNotNull(prefs.getString(InstallLease.CATALOG_ACCOUNTS, null))
        val deadline = marker.substringBefore(',').toLong()
        assertThat(deadline).isEqualTo(tappedAt + 180_000L)
        val remaining = deadline - SystemClock.elapsedRealtime()
        val watchdog = shadowOf(service.get().timerLooper)
        watchdog.idleFor(Duration.ofMillis(remaining - 1))
        assertThat(accountsBlocked()).isFalse()
        watchdog.idleFor(Duration.ofMillis(1))

        assertThat(accountsBlocked()).isTrue()
        assertThat(InstallWindow.current(context)).isEqualTo(pkg)
    }

    @Test
    fun `one Google account during fallback relocks and opens Play without warning`() {
        val activity = startFallback()
        shadowOf(AccountManager.get(context)).addAccount(Account("parent", "com.google"))
        pumpUntil { activity.isFinishing }

        assertThat(accountsBlocked()).isTrue()
        assertThat(activity.isFinishing).isTrue()
        assertThat(shadowOf(activity).nextStartedActivity.data).isEqualTo(InstallWindow.playIntent(pkg).data)
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
    }

    @Test
    fun `closing the install window relocks accounts`() {
        startFallback()
        InstallWindow.close(context, "test explicit close", pkg)
        pumpUntil { accountsBlocked() }
        assertThat(accountsBlocked()).isTrue()
        assertThat(InstallWindow.current(context)).isNull()
    }

    @Test
    fun `deadline recovery relocks accounts`() {
        startFallback()
        ShadowSystemClock.advanceBy(Duration.ofMillis(InstallWindow.WINDOW_MS))
        InstallLease.android(context).recover()
        assertThat(accountsBlocked()).isTrue()
        assertThat(InstallWindow.current(context)).isNull()
    }

    @Test
    fun `startup recovery relocks accounts from a previous process before the deadline`() {
        startFallback()
        val prefs = context.getSharedPreferences("plainphone_install_lease", Context.MODE_PRIVATE)
        val marker = checkNotNull(prefs.getString(InstallLease.CATALOG, null)).split(',').toMutableList()
        marker[3] = "previous-process"
        prefs.edit().putString(InstallLease.CATALOG, marker.joinToString(",")).apply()
        Lock.recoverInstallAsync(context)
        pumpUntil { accountsBlocked() }
        assertThat(accountsBlocked()).isTrue()
        assertThat(InstallWindow.current(context)).isNull()
    }

    @Test
    fun `a newer window cannot suppress a matching late account warning`() {
        val first = installPrompt()
        submit(first, pin, expectAccountRequest = true)
        InstallWindow.close(context, "test overlap", pkg)
        val second = installPrompt()
        val pinFields = fields(second)
        (pinFields.getChildAt(1) as EditText).setText(pin)
        (pinFields.getChildAt(2) as Button).performClick()
        val requests = context.getSharedPreferences("plainphone_catalog_accounts", Context.MODE_PRIVATE)
        pumpUntil { requests.all.size == 2 }
        assertThat(requests.all).hasSize(2)

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `a login left open past its marker is still reported`() {
        val activity = installPrompt()
        submit(activity, pin, expectAccountRequest = true)
        ShadowSystemClock.advanceBy(Duration.ofDays(1))
        InstallLease.android(context).recover()

        assertThat(AccountManager.get(context).addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        // The marker has expired, but the account is outside the approved set (#75).
        assertThat(context.getSharedPreferences("plainphone_catalog_accounts", Context.MODE_PRIVATE).all).isEmpty()
        assertThat(StatusNotices(context).pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNotNull()
    }

    @Test
    fun `an account outside the approved set is reported once`() {
        val manager = AccountManager.get(context)
        assertThat(manager.addAccountExplicitly(Account("late", "com.google"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()
        val notices = StatusNotices(context)
        val first = checkNotNull(notices.pending(StatusNotices.LATE_GOOGLE_ACCOUNT))
        notices.acknowledge(StatusNotices.LATE_GOOGLE_ACCOUNT, first)

        // Another account change does not report the same account again.
        assertThat(manager.addAccountExplicitly(Account("app", "org.example"), null, null)).isTrue()
        shadowOf(Looper.getMainLooper()).idle()

        assertThat(notices.pending(StatusNotices.LATE_GOOGLE_ACCOUNT)).isNull()
    }

    @Test
    fun `the approved set keeps only salted fingerprints on the phone`() {
        preexisting(Account("parent@example.org", "com.google"))

        val stored = context.getSharedPreferences("plainphone_approved_accounts", Context.MODE_PRIVATE).all
        assertThat(stored.toString()).doesNotContain("parent@example.org")
        assertThat(stored["approved"] as Set<*>).hasSize(1)
        val account = Account("parent@example.org", "com.google")
        assertThat(ApprovedAccounts.fingerprint(ByteArray(32) { 1 }, account))
            .isNotEqualTo(ApprovedAccounts.fingerprint(ByteArray(32) { 2 }, account))
    }

    @Test
    fun `the lock reports accounts as lifted until the fallback deadline, not as intact`() {
        val before = System.currentTimeMillis()
        startFallback()

        val lifted = Lock.lockState(context).liftedPolicies.single()
        assertThat(lifted.name).isEqualTo(LiftedPolicy.ACCOUNTS)
        assertThat(lifted.untilMs).isIn(com.google.common.collect.Range.closed(before, System.currentTimeMillis() + CatalogAccounts.FALLBACK_MS))
        val step = Lock.applyNow(context, "lifted status").single { it.name == LiftedPolicy.ACCOUNTS }
        assertThat(step.liftedUntilMs).isEqualTo(lifted.untilMs)
        assertThat(accountsBlocked()).isFalse()

        ShadowSystemClock.advanceBy(Duration.ofMinutes(3))
        InstallLease.android(context).recover()

        assertThat(accountsBlocked()).isTrue()
        assertThat(Lock.lockState(context).liftedPolicies).isEmpty()
    }

    @Test
    fun `closing the window cancels the pending sign-in request`() {
        submit(installPrompt(), pin, expectAccountRequest = true)
        val leaseId = checkNotNull(InstallLease.android(context).catalogId())
        val open = FakeFuture()
        CatalogAccounts.trackSignIn(context, CatalogAccounts.Request("open", leaseId, pkg, emptySet(), false), open)
        val stale = FakeFuture()
        CatalogAccounts.trackSignIn(context, CatalogAccounts.Request("stale", "closed", pkg, emptySet(), false), stale)
        assertThat(open.isCancelled).isFalse()
        assertThat(stale.isCancelled).isTrue()

        InstallWindow.close(context, "test window end", pkg)
        pumpUntil { open.isCancelled }

        assertThat(open.isCancelled).isTrue()
    }

    private class FakeFuture : android.accounts.AccountManagerFuture<android.os.Bundle> {
        @Volatile private var cancelled = false
        override fun cancel(mayInterruptIfRunning: Boolean): Boolean { cancelled = true; return true }
        override fun isCancelled() = cancelled
        override fun isDone() = cancelled
        override fun getResult(): android.os.Bundle = throw android.accounts.OperationCanceledException()
        override fun getResult(timeout: Long, unit: TimeUnit?): android.os.Bundle = getResult()
    }

    /** An account that was on the phone before the lock: part of the approved set. */
    private fun preexisting(account: Account) {
        val manager = AccountManager.get(context)
        val listeners = shadowOf(manager).listeners
        val registered = listeners.toMap()
        listeners.clear()
        try {
            shadowOf(manager).addAccount(account)
        } finally {
            listeners.putAll(registered)
        }
        ApprovedAccounts.approveCurrent(context)
    }

    @Test
    fun `a second PIN prompt does not offer fallback while sign-in is pending`() {
        submit(installPrompt(), pin, expectAccountRequest = true)
        val reopened = installPrompt()
        submit(reopened, pin)

        assertThat(fallback(reopened).visibility).isEqualTo(View.GONE)
        assertThat(accountsBlocked()).isTrue()
    }

    @Test
    fun `the fallback offer disappears at the catalog deadline`() {
        val activity = installPrompt()
        submit(activity, pin, expectAccountRequest = true)
        completeWithoutGoogleAccount()
        pumpUntil { fallback(activity).visibility == View.VISIBLE }
        assertThat(fallback(activity).visibility).isEqualTo(View.VISIBLE)

        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(InstallWindow.WINDOW_MS))

        assertThat(fallback(activity).visibility).isEqualTo(View.GONE)
        assertThat(message(activity).text.toString()).doesNotContain(fallback(activity).text.toString())
    }

    private fun startFallback(beforeTap: () -> Unit = {}): MaintenanceActivity {
        val activity = installPrompt()
        submit(activity, pin, expectAccountRequest = true)
        completeWithoutGoogleAccount()
        pumpUntil { fallback(activity).visibility == View.VISIBLE }
        assertThat(fallback(activity).visibility).isEqualTo(View.VISIBLE)
        beforeTap()
        fallback(activity).performClick()
        pumpUntil { !accountsBlocked() }
        shadowOf(Looper.getMainLooper()).idle()
        assertThat(accountsBlocked()).isFalse()
        return activity
    }

    private fun completeWithoutGoogleAccount() {
        // Robolectric completes the pending authenticator callback on addAccount.
        shadowOf(AccountManager.get(context)).addAccount(Account("test", "org.example"))
    }

    private fun fallback(activity: MaintenanceActivity) =
        activity.findViewById<Button>(R.id.maintenance_allow_accounts)

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
