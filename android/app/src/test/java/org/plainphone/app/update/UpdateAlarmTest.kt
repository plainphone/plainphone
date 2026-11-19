// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.update

import android.app.AlarmManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageInstaller
import android.os.PowerManager
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
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.PlainphoneApplication
import org.plainphone.app.RelockReceiver
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.catalog.InstallWindow
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowSystemClock
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.FakeSyncApi
import org.plainphone.app.sync.FakeSyncDevice
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.SyncWorker
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class UpdateAlarmTest {
    private val context: Context = ApplicationProvider.getApplicationContext()
    private val alarms = shadowOf(context.getSystemService(AlarmManager::class.java))

    private val installThread = java.util.concurrent.Executors.newCachedThreadPool()
    private val app get() = context as android.app.Application
    private val service by lazy { Robolectric.buildService(InstallWatchdogService::class.java).create() }
    private var startId = 0

    @After fun stopWatchdog() {
        installThread.shutdownNow()
        // A still-running install thread would touch the next test's lease state.
        assertTrue(installThread.awaitTermination(5, TimeUnit.SECONDS))
        if (startId > 0) service.destroy()
        // Lock's recovery executor and InstallLease's counters are process-wide: leave them clean.
        awaitRecovery()
        InstallLease.resetStateForTests()
        AndroidLeaseEnv.wallClock = System::currentTimeMillis
    }

    private fun <T> startInstall(block: () -> T): java.util.concurrent.Future<T> {
        val result = installThread.submit(java.util.concurrent.Callable(block))
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(5)
        while (!result.isDone && System.nanoTime() < deadline) {
            val intent = shadowOf(app).nextStartedService
            if (intent?.component?.className == InstallWatchdogService::class.java.name) {
                service.get().onStartCommand(intent, 0, ++startId)
                break
            }
            Thread.sleep(1)
        }
        return result
    }

    private fun <T> withWatchdog(block: () -> T): T = startInstall(block).get(5, TimeUnit.SECONDS)

    @Before fun becomeDeviceOwner() {
        val dpm = shadowOf(context.getSystemService(DevicePolicyManager::class.java))
        val admin = PlainphoneAdminReceiver.component(context)
        dpm.setActiveAdmin(admin)
        assertTrue(dpm.setDeviceOwner(admin))
        shadowOf(context.getSystemService(PowerManager::class.java))
            .setIgnoringBatteryOptimizations(context.packageName, true)
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        // A recovery queued by an earlier test or class must not run against this test's lease.
        awaitRecovery()
        InstallLease.resetStateForTests()
    }

    private fun approveCatalogTarget() {
        org.plainphone.app.sync.SyncStore(context).saveRules(
            "catalog-test",
            """{
                "phoneId":"test","profile":"child","timezone":"UTC",
                "apps":{"allowed":[],"hidden":[],"toInstall":[{"packageName":"org.example.approved"}]},
                "contacts":[],"schedules":[],"dns":{},"location":{"enabled":false}
            }""",
            System.currentTimeMillis(),
        )
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
        approveCatalogTarget()
        val prefs = context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE)
        repeat(InstallWindow.MAX_PER_DAY) {
            withWatchdog {
                InstallWindow.open(context, "org.example.approved") {
                    assertEquals(1, prefs.getInt("windows", 0))
                    throw SecurityException("Android refused the install restriction change")
                }
            }
            awaitRecovery()
        }
        assertFalse(InstallLease.android(context).isOpen(InstallLease.CATALOG))
        assertEquals(0, prefs.getInt("windows", 0))

        withWatchdog { InstallWindow.open(context, "org.example.approved") }
        assertEquals("org.example.approved", InstallWindow.current(context))
        assertEquals(1, prefs.getInt("windows", 0))
    }

    @Test fun strongModeWithoutBatteryExemptionKeepsInstallsRestricted() {
        context.getSystemService(DevicePolicyManager::class.java).addUserRestriction(
            PlainphoneAdminReceiver.component(context), UserManager.DISALLOW_INSTALL_APPS,
        )
        shadowOf(context.getSystemService(PowerManager::class.java))
            .setIgnoringBatteryOptimizations(context.packageName, false)

        val future = startInstall {
            Lock.createUpdateSession(context) { throw AssertionError("Session must not open") }
        }
        val failure = assertThrows(java.util.concurrent.ExecutionException::class.java) {
            future.get(5, TimeUnit.SECONDS)
        }
        assertTrue(failure.cause is IllegalStateException)
        assertRecovered()
        assertTrue(alarms.scheduledAlarms.isEmpty())
    }

    @Test fun catalogInstalledDuringPolicyApplicationStillUsesQuota() {
        approveCatalogTarget()
        withWatchdog {
            InstallWindow.open(context, "org.example.approved") { opened ->
                Lock.applyForInstall(context, "test catalog window", true, opened)
                assertFalse(installsRestricted())
                shadowOf(context.packageManager).installPackage(
                    android.content.pm.PackageInfo().apply { packageName = "org.example.approved" },
                )
            }
        }
        awaitRecovery()
        assertTrue(installsRestricted())
        assertEquals(1, context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE).getInt("windows", 0))
    }

    @Test fun processDeathAfterOpeningCatalogPreservesReservedQuota() {
        approveCatalogTarget()
        val prefs = context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE)
        var committedQuota = 0
        val quotaContext = object : ContextWrapper(context) {
            override fun getApplicationContext(): Context = this

            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                val delegate = super.getSharedPreferences(name, mode)
                if (name != "plainphone_install") return delegate
                return object : SharedPreferences by delegate {
                    override fun edit(): SharedPreferences.Editor {
                        val editor = delegate.edit()
                        return object : SharedPreferences.Editor by editor {
                            private var quota: Int? = null

                            override fun putString(key: String, value: String?): SharedPreferences.Editor {
                                editor.putString(key, value)
                                return this
                            }

                            override fun putInt(key: String, value: Int): SharedPreferences.Editor {
                                editor.putInt(key, value)
                                if (key == "windows") quota = value
                                return this
                            }

                            override fun commit(): Boolean = editor.commit().also { saved ->
                                if (saved) quota?.let { committedQuota = it }
                            }
                        }
                    }
                }
            }
        }
        val stop = Error("simulated process death before open returns")
        val future = startInstall {
            InstallWindow.open(quotaContext, "org.example.approved") { opened ->
                assertEquals(1, committedQuota)
                Lock.applyForInstall(context, "test catalog window", true, opened)
                assertFalse(installsRestricted())
                throw stop
            }
        }
        val error = assertThrows(java.util.concurrent.ExecutionException::class.java) {
            future.get(5, TimeUnit.SECONDS)
        }
        if (error.cause !== stop) throw error
        markLeaseFromAnotherProcess(InstallLease.CATALOG)
        Lock.recoverInstall(context)
        assertTrue(installsRestricted())
        assertNull(InstallWindow.current(context))
        assertEquals(1, prefs.getInt("windows", 0))
    }

    @Test fun alreadyInstalledCatalogTargetDoesNotConsumeTheLastSlot() {
        approveCatalogTarget()
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        val prefs = context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE)
        prefs.edit().putString("day", java.time.LocalDate.now().toString())
            .putInt("windows", InstallWindow.MAX_PER_DAY - 1).apply()

        InstallWindow.open(context, context.packageName)
        assertEquals(InstallWindow.MAX_PER_DAY - 1, prefs.getInt("windows", 0))
        assertFalse(InstallLease.android(context).isOpen(InstallLease.CATALOG))

        withWatchdog { InstallWindow.open(context, "org.example.approved") }
        assertEquals("org.example.approved", InstallWindow.current(context))
        assertEquals(InstallWindow.MAX_PER_DAY, prefs.getInt("windows", 0))
    }

    @Test fun sessionCreationRestoresTheRestrictionOnReturnAndFailure() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        val id = withWatchdog {
            Lock.createUpdateSession(context) {
                assertFalse(installsRestricted())
                42
            }
        }
        assertEquals(42, id)
        assertRecovered()
        assertTrue(alarms.scheduledAlarms.isEmpty())

        val failed = startInstall {
            Lock.createUpdateSession(context) {
                assertFalse(installsRestricted())
                throw SecurityException("Android refused the session")
            }
        }
        assertTrue(assertThrows(java.util.concurrent.ExecutionException::class.java) {
            failed.get(5, TimeUnit.SECONDS)
        }.cause is SecurityException)
        assertRecovered()
    }

    @Test fun installerSuccessAndFailureRestoreTheRestrictionWithoutAnAlarm() {
        val lease = InstallLease.android(context)
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        for ((id, status) in listOf(PackageInstaller.STATUS_SUCCESS, PackageInstaller.STATUS_FAILURE).withIndex()) {
            withWatchdog { lease.acquire(InstallLease.SELF_UPDATE, 360_000L) }
            // A session opened by the previous implementation can still report a result.
            val record = checkNotNull(leasePrefs.getString(InstallLease.SELF_UPDATE, null))
            val legacy = record.split(',').take(4) + id.toString()
            leasePrefs.edit().putString(InstallLease.SELF_UPDATE, legacy.joinToString(",")).apply()
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

    @Test fun delayedRelockIsIncludedInTheNextStatusReport() {
        restoreOverdueLease(overrunMs = 45_000)
        Lock.recoverInstall(context)
        assertRecovered()
        assertReportedOverrun(45)
    }

    @Test fun startupReportsAnExpiredLeaseEvenWithinTheGracePeriod() {
        restoreOverdueLease(overrunMs = 5_000, previousProcess = true)
        Lock.recoverInstall(context)
        assertRecovered()
        assertReportedOverrun(5)
    }

    @Test fun startupReportsAnExpiredInvalidatedLeaseIfInstallsWereStillAllowed() {
        restoreOverdueLease(overrunMs = 5_000, previousProcess = true, invalidated = true)
        Lock.recoverInstall(context)
        assertRecovered()
        assertReportedOverrun(5)
    }

    @Test fun rebootReportsAnOverrunForALegacyLeaseWithoutAWallDeadline() {
        restoreOverdueLease(overrunMs = 4_001, previousBoot = true, hasWallDeadline = false)
        Lock.recoverInstall(context)
        assertRecovered()
        assertReportedOverrun(0)
    }

    @Test fun rebootUsesThePersistedDeadlineWhenElapsedTimeStartsOver() {
        restoreOverdueLease(overrunMs = 4_001, previousBoot = true)
        Lock.recoverInstall(context)
        assertRecovered()
        assertReportedOverrun(5)
    }

    @Test fun overrunStopsReportingAfterAcknowledgement() {
        restoreOverdueLease(overrunMs = 40_000)
        Lock.recoverInstall(context)
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("phone", "pp_d_token")
        val api = FakeSyncApi()
        val runner = SyncRunner(store, api, FakeSyncDevice().apply { now = System.currentTimeMillis() })
        val failingApi = object : org.plainphone.app.sync.SyncApi by api {
            override fun reportStatus(token: String, status: org.plainphone.app.sync.DeviceStatus) {
                throw java.io.IOException("offline")
            }
        }
        SyncRunner(store, failingApi, FakeSyncDevice().apply { now = System.currentTimeMillis() }).run("offline")
        runner.run("report the overrun")
        runner.run("report without the acknowledged overrun")
        assertEquals(
            listOf(listOf("install window overran: 40s"), emptyList<String>()),
            api.statuses.map { it.failedPolicies },
        )
        assertEquals(1L, api.statuses.first().toJson().getLong("installOverrunSequence"))
        assertFalse(api.statuses.last().toJson().has("installOverrunSequence"))
    }

    @Test fun legacyOverrunSurvivesUpgradeAndExpiresFromFirstRead() {
        assertTrue(leasePrefs.edit().putString("last_overrun", "40,3").commit())
        val start = System.currentTimeMillis()
        val store = SyncStore(context, FakeSecretBox())
        assertEquals(40L, store.installWindowOverrun(start)?.seconds)
        assertEquals(3L, store.installWindowOverrun(start)?.sequence)
        assertNull(store.installWindowOverrun(start + Duration.ofDays(7).toMillis()))
        store.acknowledgeInstallOverrun(3)
        assertNull(store.installWindowOverrun(start))
    }

    @Test fun overrunExpiresEvenWithoutAcknowledgement() {
        restoreOverdueLease(overrunMs = 40_000)
        Lock.recoverInstall(context)
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("phone", "pp_d_token")
        val api = FakeSyncApi()
        val device = FakeSyncDevice().apply { now = System.currentTimeMillis() + Duration.ofDays(7).toMillis() }
        SyncRunner(store, api, device).run("after the overrun expired")
        assertTrue(api.statuses.single().failedPolicies.isEmpty())
    }

    private fun restoreOverdueLease(
        overrunMs: Long,
        previousProcess: Boolean = false,
        previousBoot: Boolean = false,
        invalidated: Boolean = false,
        hasWallDeadline: Boolean = true,
    ) {
        ShadowSystemClock.advanceBy(Duration.ofMinutes(1))
        // Pin wall time too, or the reported overrun drifts with machine load.
        val wall = System.currentTimeMillis()
        AndroidLeaseEnv.wallClock = { wall }
        val env = AndroidLeaseEnv(context)
        // Simulate recovery after Android delayed delivery, with no watchdog or alarm queued.
        val elapsedDeadline = if (previousBoot) env.nowMs() + 60_000L else env.nowMs() - overrunMs
        val boot = if (previousBoot) env.bootCount() - 1 else env.bootCount()
        val process = if (previousProcess || previousBoot) "previous-process" else env.processId()
        val record = if (hasWallDeadline) {
            "$elapsedDeadline,$boot,0,$process,,${env.wallNowMs() - overrunMs},$invalidated"
        } else {
            "$elapsedDeadline,$boot,0,$process"
        }
        assertTrue(leasePrefs.edit().putString(InstallLease.SELF_UPDATE, record).commit())
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        dpm.clearUserRestriction(PlainphoneAdminReceiver.component(context), UserManager.DISALLOW_INSTALL_APPS)
        assertFalse(installsRestricted())
    }

    private fun assertReportedOverrun(seconds: Long) {
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("phone", "pp_d_token")
        val api = FakeSyncApi()
        SyncRunner(store, api, FakeSyncDevice().apply { now = System.currentTimeMillis() }).run("after install recovery")
        val status = api.statuses.single()
        assertEquals(listOf("install window overran: ${seconds}s"), status.failedPolicies)
        assertTrue(status.lockIntact)
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

    @Test fun startupRestoresAnUnrestrictedOwnerWithoutALease() {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        dpm.clearUserRestriction(PlainphoneAdminReceiver.component(context), UserManager.DISALLOW_INSTALL_APPS)
        assertFalse(installsRestricted())
        Lock.recoverInstall(context)
        assertTrue(installsRestricted())
    }

    @Test fun mergedManifestDeclaresBootAndReplacementRecovery() {
        val factory = javax.xml.parsers.DocumentBuilderFactory.newInstance().apply { isNamespaceAware = true }
        val config = java.util.Properties()
        checkNotNull(javaClass.getResourceAsStream("/com/android/tools/test_config.properties")).use(config::load)
        val manifest = java.io.File(config.getProperty("android_merged_manifest"))
        val document = factory.newDocumentBuilder().parse(manifest)
        val android = "http://schemas.android.com/apk/res/android"
        val receivers = document.getElementsByTagName("receiver")
        val receiver = (0 until receivers.length).map { receivers.item(it) as org.w3c.dom.Element }
            .single { it.getAttributeNS(android, "name") == RelockReceiver::class.java.name }
        val actions = receiver.getElementsByTagName("action")
        val names = (0 until actions.length).map {
            (actions.item(it) as org.w3c.dom.Element).getAttributeNS(android, "name")
        }
        assertTrue(Intent.ACTION_BOOT_COMPLETED in names)
        assertTrue(Intent.ACTION_MY_PACKAGE_REPLACED in names)
        val services = document.getElementsByTagName("service")
        val watchdog = (0 until services.length).map { services.item(it) as org.w3c.dom.Element }
            .single { it.getAttributeNS(android, "name") == InstallWatchdogService::class.java.name }
        assertEquals("systemExempted", watchdog.getAttributeNS(android, "foregroundServiceType"))
        assertEquals("false", watchdog.getAttributeNS(android, "exported"))
    }

    private val leasePrefs get() = context.getSharedPreferences("plainphone_install_lease", Context.MODE_PRIVATE)

    private fun markLeaseFromAnotherProcess(holder: String = InstallLease.SELF_UPDATE) {
        val parts = checkNotNull(leasePrefs.getString(holder, null)).split(',').toMutableList()
        parts[3] = "previous-process"
        assertTrue(leasePrefs.edit().putString(holder, parts.joinToString(",")).commit())
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

    @Test fun openingSelfUpdateSchedulesTheExpiryAlarm() {
        val expiry = SystemClock.elapsedRealtime() + 360_000L
        openSelfUpdate()
        val alarm = alarms.scheduledAlarms.single()
        assertEquals(AlarmManager.ELAPSED_REALTIME_WAKEUP, alarm.getType())
        assertEquals(expiry, alarm.triggerAtMs)
        assertTrue(alarm.isAllowWhileIdle)
        @Suppress("DEPRECATION") // Robolectric exposes the scheduled PendingIntent through this field.
        val intent = shadowOf(checkNotNull(alarm.operation)).savedIntent
        assertEquals(UpdateReceiver.ACTION_LEASE_EXPIRED, intent.action)
        assertEquals(InstallLease.SELF_UPDATE, intent.data?.schemeSpecificPart)
    }

    @Test fun scheduledAlarmBroadcastRestoresTheRestriction() {
        // Model delayed alarm delivery after the watchdog and worker are gone.
        restoreOverdueLease(overrunMs = 0)
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        UpdateReceiver.scheduleLeaseExpiry(context, InstallLease.SELF_UPDATE, SystemClock.elapsedRealtime())
        val alarm = alarms.scheduledAlarms.single()
        assertFalse(installsRestricted())
        alarms.fireAlarm(alarm)
        shadowOf(android.os.Looper.getMainLooper()).idle()
        awaitRecovery()
        assertRecovered()
    }

    private fun openSelfUpdate() {
        ShadowAlarmManager.setCanScheduleExactAlarms(true)
        withWatchdog { InstallLease.android(context).acquire(InstallLease.SELF_UPDATE, 360_000L) }
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

    @Test fun foregroundDeadlineRelocksWhileSessionCreationIsHungWithoutExactAlarmAccess() {
        ShadowAlarmManager.setCanScheduleExactAlarms(false)
        val entered = java.util.concurrent.CountDownLatch(1)
        val resume = java.util.concurrent.CountDownLatch(1)
        val install = startInstall {
            Lock.createUpdateSession(context) {
                entered.countDown()
                check(resume.await(5, TimeUnit.SECONDS))
                42
            }
        }
        try {
            assertTrue(entered.await(5, TimeUnit.SECONDS))
            assertFalse(installsRestricted())
            assertNotNull(shadowOf(service.get()).lastForegroundNotification)
            UpdateReceiver.cancelLeaseExpiry(context, InstallLease.SELF_UPDATE)
            shadowOf(service.get().timerLooper).idleFor(Duration.ofSeconds(10))
            assertRecovered()
            assertFalse(install.isDone)
        } finally {
            resume.countDown()
        }
        assertTrue(assertThrows(java.util.concurrent.ExecutionException::class.java) {
            install.get(5, TimeUnit.SECONDS)
        }.cause is IllegalStateException)
    }
}
