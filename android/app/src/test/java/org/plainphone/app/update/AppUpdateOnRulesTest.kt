// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.PowerManager
import androidx.test.core.app.ApplicationProvider
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import android.app.Application
import android.os.Looper
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Before
import org.robolectric.Robolectric
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.sync.AppUpdateRules
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager

/** The side effects of AppUpdateWindow.onRules; the decisions themselves are in AppUpdateRulesPlanTest. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class AppUpdateOnRulesTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val heldBackKey = "held_back"
    private val service by lazy { Robolectric.buildService(InstallWatchdogService::class.java).create() }
    private var startId = 0

    @After
    fun stopWatchdog() {
        if (startId > 0) service.destroy()
    }

    /** open() arms the watchdog off the main thread; this thread plays the foreground service's side. */
    private fun <T> offMain(block: () -> T): T {
        val result = AtomicReference<T>()
        val worker = Thread { result.set(block()) }
        worker.start()
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(10)
        while (worker.isAlive && System.nanoTime() < deadline) {
            val intent = shadowOf(context as Application).nextStartedService
            if (intent?.component?.className == InstallWatchdogService::class.java.name) {
                service.get().onStartCommand(intent, 0, ++startId)
            }
            shadowOf(Looper.getMainLooper()).idle()
            Thread.sleep(5)
        }
        worker.join(1_000)
        return result.get()
    }

    private fun open(trigger: AppUpdateLog.Trigger) = offMain { AppUpdateWindow.open(context, trigger) }

    private fun onRules() = offMain { AppUpdateWindow.onRules(context) }

    /** A window the phone has logged as closed, without involving the lease. */
    private fun loggedWindow(id: String): String {
        val now = System.currentTimeMillis()
        val log = AppUpdateWindow.log(context)
        log.opened(id, AppUpdateLog.Trigger.PARENT, now, now + 1_000, emptySet())
        log.closed(now)
        return id
    }

    @Before
    fun preparePhone() {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        val admin = PlainphoneAdminReceiver.component(context)
        shadowOf(dpm).setActiveAdmin(admin)
        assertThat(shadowOf(dpm).setDeviceOwner(admin)).isTrue()
        shadowOf(context.getSystemService(PowerManager::class.java))
            .setIgnoringBatteryOptimizations(context.packageName, true)
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }

    private fun saveRules(
        automatic: Boolean = true,
        requestedAtMs: Long? = null,
        reportedWindow: String? = null,
        recorded: List<String> = emptyList(),
    ) {
        val requested = requestedAtMs?.let { "\"${java.time.Instant.ofEpochMilli(it)}\"" } ?: "null"
        val window = reportedWindow?.let { "\"$it\"" } ?: "null"
        val appUpdates = """"appUpdates":{"automatic":$automatic,"requestedAt":$requested,""" +
            """"reportedWindow":$window,"recordedApps":${recorded.joinToString(",", "[", "]") { "\"$it\"" }}},"""
        val json = rulesJson().replaceFirst("\"pollSeconds\"", "$appUpdates\"pollSeconds\"")
        SyncStore(context).saveRules("r", json, 0)
    }

    private fun heldBack() = AppUpdateWindow.heldBack(context)

    private fun holdBack(vararg packages: String) {
        context.getSharedPreferences("plainphone_app_updates", Context.MODE_PRIVATE).edit()
            .putStringSet(heldBackKey, packages.toSet()).commit()
    }

    @Test
    fun `Update apps now opens a window once per request`() {
        val asked = System.currentTimeMillis() - 1_000
        saveRules(requestedAtMs = asked)

        onRules()
        assertThat(AppUpdateWindow.isOpen(context)).isTrue()
        assertThat(AppUpdateWindow.log(context).current()?.trigger).isEqualTo(AppUpdateLog.Trigger.PARENT)

        AppUpdateWindow.close(context, "test")
        assertThat(AppUpdateWindow.isOpen(context)).isFalse()
        onRules()
        assertThat(AppUpdateWindow.isOpen(context)).isFalse()
    }

    @Test
    fun `switching automatic updates off closes a nightly window`() {
        assertThat(open(AppUpdateLog.Trigger.NIGHT)).isEqualTo(AppUpdateWindow.OpenResult.OPENED)
        saveRules(automatic = true)
        onRules()
        assertThat(AppUpdateWindow.isOpen(context)).isTrue()

        saveRules(automatic = false)
        onRules()

        assertThat(AppUpdateWindow.isOpen(context)).isFalse()
    }

    @Test
    fun `a held-back app is let go once the server recorded the window that caught it`() {
        val id = loggedWindow("w-now")
        holdBack("com.example.game", "com.example.chat")

        saveRules(reportedWindow = id, recorded = listOf("com.example.game"))
        onRules()

        assertThat(heldBack()).containsExactly("com.example.chat")
    }

    @Test
    fun `an app recorded in an earlier window stays held back until this window is recorded`() {
        val id = loggedWindow("w-now")
        holdBack("com.example.game")

        // The server still lists the game from the window before this one.
        saveRules(reportedWindow = "earlier-window", recorded = listOf("com.example.game"))
        onRules()
        assertThat(heldBack()).containsExactly("com.example.game")

        saveRules(reportedWindow = id, recorded = listOf("com.example.game"))
        onRules()
        assertThat(heldBack()).isEmpty()
    }

    @Test
    fun `the close of a window is retried until the server has the report`() {
        assertThat(open(AppUpdateLog.Trigger.NIGHT)).isEqualTo(AppUpdateWindow.OpenResult.OPENED)
        val log = AppUpdateWindow.log(context)
        AppUpdateWindow.close(context, "test")
        AppUpdateWindow.onLeaseClosed(context)
        assertThat(AppUpdateWindow.closeReportPending(context)).isTrue()

        // A report of the window while it was still open does not end the retry.
        val closed = checkNotNull(log.report(System.currentTimeMillis(), leaseOpen = false))
        AppUpdateWindow.onReported(context, closed.copy(closedAtMs = null))
        assertThat(AppUpdateWindow.closeReportPending(context)).isTrue()

        AppUpdateWindow.onReported(context, closed)
        assertThat(AppUpdateWindow.closeReportPending(context)).isFalse()
    }

    @Test
    fun `plan keeps held-back apps when the phone has no window yet`() {
        val rules = AppUpdateRules(reportedWindow = "w1", recordedApps = setOf("com.game"))
        val plan = AppUpdateWindow.plan(rules, setOf("com.game"), 0L, null, 0L, currentWindowId = null)
        assertThat(plan.letGo).isEmpty()
    }
}
