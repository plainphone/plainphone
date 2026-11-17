// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.update

import android.app.AlarmManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.UserManager
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkManager
import androidx.work.WorkInfo
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import java.time.Duration
import java.util.concurrent.TimeUnit
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.PlainphoneApplication
import org.plainphone.app.RelockReceiver
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.catalog.InstallWindow
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowSystemClock
import org.plainphone.app.sync.SyncWorker
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class UpdateAlarmTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val alarms = shadowOf(context.getSystemService(AlarmManager::class.java))

    @Before fun becomeDeviceOwner() {
        val dpm = shadowOf(context.getSystemService(DevicePolicyManager::class.java))
        val admin = PlainphoneAdminReceiver.component(context)
        dpm.setActiveAdmin(admin)
        assertTrue(dpm.setDeviceOwner(admin))
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }

    @Test fun strongModeArmsAnExactElapsedTimeWakeupWhileIdle() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        val expiry = SystemClock.elapsedRealtime() + 360_000L
        UpdateReceiver.scheduleLeaseExpiry(context, InstallLease.SELF_UPDATE, expiry)
        val alarm = alarms.scheduledAlarms.single()
        assertEquals(AlarmManager.ELAPSED_REALTIME_WAKEUP, alarm.getType())
        assertEquals(expiry, alarm.triggerAtMs)
        assertEquals(0L, alarm.windowLengthMs)
        assertTrue(alarm.isAllowWhileIdle)
    }

    @Test fun rejectedCatalogAttemptsLeaveTheDailyQuotaIntact() {
        ShadowAlarmManager.setCanScheduleExactAlarms(false)
        repeat(InstallWindow.MAX_PER_DAY) {
            InstallWindow.open(context, "org.example.approved")
        }
        assertFalse(InstallLease.android(context).isOpen(InstallLease.CATALOG))
        val prefs = context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE)
        assertEquals(0, prefs.getInt("windows", 0))

        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        InstallWindow.open(context, "org.example.approved")
        assertEquals("org.example.approved", InstallWindow.current(context))
        assertEquals(1, prefs.getInt("windows", 0))
    }

    @Test fun alreadyInstalledCatalogTargetDoesNotConsumeTheLastSlot() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        val prefs = context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE)
        prefs.edit().putString("day", java.time.LocalDate.now().toString())
            .putInt("windows", InstallWindow.MAX_PER_DAY - 1).apply()

        InstallWindow.open(context, context.packageName)
        assertEquals(InstallWindow.MAX_PER_DAY - 1, prefs.getInt("windows", 0))
        assertFalse(InstallLease.android(context).isOpen(InstallLease.CATALOG))

        InstallWindow.open(context, "org.example.approved")
        assertEquals("org.example.approved", InstallWindow.current(context))
        assertEquals(InstallWindow.MAX_PER_DAY, prefs.getInt("windows", 0))
    }

    @Test fun sessionCreationRestoresTheRestrictionOnReturnAndFailure() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        val id = Lock.createUpdateSession(context) {
            assertFalse(installsRestricted())
            42
        }
        assertEquals(42, id)
        assertRecovered()

        assertThrows(SecurityException::class.java) {
            Lock.createUpdateSession(context) {
                assertFalse(installsRestricted())
                throw SecurityException("Android refused the session")
            }
        }
        assertRecovered()
    }

    @Test fun installerSuccessAndFailureRestoreTheRestrictionWithoutAnAlarm() {
        val lease = InstallLease.android(context)
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        for ((id, status) in listOf(PackageInstaller.STATUS_SUCCESS, PackageInstaller.STATUS_FAILURE).withIndex()) {
            lease.acquire(InstallLease.SELF_UPDATE, 360_000L)
            // A session opened by the previous implementation can still report a result.
            val record = leasePrefs.getString(InstallLease.SELF_UPDATE, null)
            leasePrefs.edit().putString(InstallLease.SELF_UPDATE, "$record$id").apply()
            assertFalse(installsRestricted())

            val stale = UpdateReceiver.expect(id + 100)
            try {
                deliverStatus(id + 100, status)
                assertNotNull(stale.await(5, TimeUnit.SECONDS))
                assertFalse(installsRestricted())
            } finally {
                UpdateReceiver.forget(id + 100)
            }

            val current = UpdateReceiver.expect(id)
            try {
                deliverStatus(id, status)
                assertEquals(status, current.await(5, TimeUnit.SECONDS)?.status)
                assertTrue(installsRestricted())
            } finally {
                UpdateReceiver.forget(id)
            }
        }
    }

    @Test fun deadlineWorkRecoversAfterExactAlarmAccessIsLost() {
        val before = System.currentTimeMillis()
        openSelfUpdate()
        val manager = WorkManager.getInstance(context)
        val work = manager.getWorkInfosByTag(InstallRecoveryWorker::class.java.name)
            .get(5, TimeUnit.SECONDS).single()
        assertEquals(WorkInfo.State.ENQUEUED, work.state)
        assertTrue(work.nextScheduleTimeMillis in (before + 360_000L)..(System.currentTimeMillis() + 360_000L))
        reachDeadlineWithoutAlarm()
        checkNotNull(WorkManagerTestInitHelper.getTestDriver(context)).setInitialDelayMet(work.id)
        assertEquals(WorkInfo.State.SUCCEEDED, manager.getWorkInfoById(work.id).get(5, TimeUnit.SECONDS)?.state)
        assertTrue(installsRestricted())
    }

    @Test fun applicationStartupRecoversAnAbandonedLease() {
        openSelfUpdate()
        markLeaseFromAnotherProcess()
        val application = PlainphoneApplication()
        org.robolectric.util.ReflectionHelpers.callInstanceMethod<Unit>(
            application, "attach",
            org.robolectric.util.ReflectionHelpers.ClassParameter.from(Context::class.java, context),
        )
        application.onCreate()
        awaitRecovery()
        assertRecovered()
    }

    @Test fun bootAndPackageReplacementRecoverAbandonedLeases() {
        for (action in listOf(Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED)) {
            openSelfUpdate()
            markLeaseFromAnotherProcess()
            val receiver = RelockReceiver()
            context.registerReceiver(receiver, android.content.IntentFilter(action), Context.RECEIVER_NOT_EXPORTED)
            try {
                context.sendBroadcast(Intent(action))
                shadowOf(android.os.Looper.getMainLooper()).idle()
                awaitRecovery()
                assertRecovered()
            } finally {
                context.unregisterReceiver(receiver)
            }
        }
    }

    private val leasePrefs get() = context.getSharedPreferences("plainphone_install_lease", Context.MODE_PRIVATE)

    private fun markLeaseFromAnotherProcess() {
        val parts = checkNotNull(leasePrefs.getString(InstallLease.SELF_UPDATE, null)).split(',').toMutableList()
        parts[3] = "previous-process"
        leasePrefs.edit().putString(InstallLease.SELF_UPDATE, parts.joinToString(",")).apply()
    }

    private fun awaitRecovery() {
        // Queue a no-op behind recovery on Lock's executor.
        val done = java.util.concurrent.CountDownLatch(1)
        Lock.onInstallResult(context, -1) { done.countDown() }
        assertTrue(done.await(5, TimeUnit.SECONDS))
    }

    private fun assertRecovered() {
        assertTrue(installsRestricted())
        assertFalse(leasePrefs.contains(InstallLease.SELF_UPDATE))
    }

    @Test fun unpairedSyncRecoversBeforeItCanSkipPolicy() {
        openSelfUpdate()
        reachDeadlineWithoutAlarm()
        val worker = TestListenableWorkerBuilder<SyncWorker>(context).build()
        assertEquals(ListenableWorker.Result.success(), worker.doWork())
        assertTrue(installsRestricted())
    }

    @Test fun updateEnrollmentAndPolicyRecoverBeforeTheirEarlyReturns() {
        val recoveries = listOf<() -> Unit>(
            {
                PrefsUpdateStateStore(context).lastCheckMs = System.currentTimeMillis()
                TestListenableWorkerBuilder<UpdateWorker>(context).build().doWork()
            },
            { TestListenableWorkerBuilder<org.plainphone.app.sync.EnrollWorker>(context).build().doWork() },
            { Lock.applyIfNeeded(context, "test policy run", Long.MAX_VALUE) },
        )
        for (recover in recoveries) {
            openSelfUpdate()
            reachDeadlineWithoutAlarm()
            recover()
            assertRecovered()
        }
    }

    @Test fun scheduledAlarmBroadcastRestoresTheRestriction() {
        openSelfUpdate()
        val alarm = alarms.scheduledAlarms.single()
        ShadowSystemClock.advanceBy(Duration.ofMinutes(6))
        alarms.fireAlarm(alarm)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        awaitRecovery()
        assertRecovered()
    }

    private fun openSelfUpdate() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        InstallLease.android(context).acquire(InstallLease.SELF_UPDATE, 360_000L)
        assertFalse(installsRestricted())
    }

    private fun reachDeadlineWithoutAlarm() {
        UpdateReceiver.cancelLeaseExpiry(context, InstallLease.SELF_UPDATE)
        ShadowAlarmManager.setCanScheduleExactAlarms(false)
        ShadowSystemClock.advanceBy(Duration.ofMinutes(6))
    }

    private fun deliverStatus(id: Int, status: Int) {
        // Deliver as a broadcast so the receiver owns a real PendingResult for goAsync().
        val receiver = UpdateReceiver()
        val filter = android.content.IntentFilter(UpdateReceiver.ACTION_STATUS)
        context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        try {
            context.sendBroadcast(Intent(UpdateReceiver.ACTION_STATUS)
                .putExtra(PackageInstaller.EXTRA_SESSION_ID, id)
                .putExtra(PackageInstaller.EXTRA_STATUS, status))
            shadowOf(android.os.Looper.getMainLooper()).idle()
        } finally {
            context.unregisterReceiver(receiver)
        }
    }

    private fun installsRestricted(): Boolean =
        context.getSystemService(UserManager::class.java).hasUserRestriction(UserManager.DISALLOW_INSTALL_APPS)

    @Test fun strongModeRefusesToScheduleAnInexactFallback() {
        ShadowAlarmManager.setCanScheduleExactAlarms(false)
        assertThrows(IllegalStateException::class.java) {
            UpdateReceiver.scheduleLeaseExpiry(context, InstallLease.SELF_UPDATE, 360_000L)
        }
        assertTrue(alarms.scheduledAlarms.isEmpty())
    }
}
