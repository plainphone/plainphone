// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Looper
import android.os.PowerManager
import androidx.test.core.app.ApplicationProvider
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import java.lang.management.ManagementFactory
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference
import org.junit.After
import org.junit.Assert.fail
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.PlainphoneAdminReceiver
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowAlarmManager

/**
 * Issue #229: the policy apply and the install lease callbacks must never wait for each other's locks.
 * AppUpdateWindow.open holds its monitor while Lock.applyForAppUpdates waits for the apply lock; an
 * apply that closes a lease under the apply lock must not then wait for that monitor.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [30])
class LockOrderTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val service by lazy { Robolectric.buildService(InstallWatchdogService::class.java).create() }
    private var startId = 0

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

    @Test
    fun `an apply that closes an app update window does not deadlock with a window opening`() {
        assertThat(offMain { AppUpdateWindow.open(context, AppUpdateLog.Trigger.NIGHT) })
            .isEqualTo(AppUpdateWindow.OpenResult.OPENED)
        // The window ends: its lease is closing, and the next apply recovers it (as the deadline does).
        assertThat(InstallLease.android(context).invalidate(InstallLease.APP_UPDATES)).isTrue()

        val opening = CountDownLatch(1)
        val applyDone = CountDownLatch(1)
        val failure = AtomicReference<Throwable>()
        val apply = Thread({
            try {
                opening.await()
                Lock.applyIfNeeded(context, "lock order test", maxAgeMs = 0L)
            } catch (e: Throwable) {
                failure.compareAndSet(null, e)
            } finally {
                applyDone.countDown()
            }
        }, "apply")
        // Holds AppUpdateWindow's monitor and then asks for the apply lock, as AppUpdateWindow.open does.
        val open = Thread({
            try {
                synchronized(AppUpdateWindow) {
                    opening.countDown()
                    // Wait until the apply holds the apply lock and is stuck on this monitor, or has finished.
                    while (apply.state != Thread.State.BLOCKED && applyDone.count > 0) Thread.onSpinWait()
                    Lock.hideNewApp(context, "org.example.unknown")
                }
            } catch (e: Throwable) {
                failure.compareAndSet(null, e)
            }
        }, "open")
        listOf(apply, open).forEach { it.isDaemon = true; it.start() }
        apply.join(10_000)
        open.join(10_000)

        if (apply.isAlive || open.isAlive) {
            val deadlocked = ManagementFactory.getThreadMXBean().findMonitorDeadlockedThreads()
            fail(
                "Deadlock between Lock's apply lock and AppUpdateWindow's monitor (#229): " +
                    "apply=${apply.state}, open=${open.state}, JVM deadlocked threads=${deadlocked?.size ?: 0}",
            )
        }
        failure.get()?.let { throw AssertionError("a thread failed", it) }
        // The lease-closed work still runs, just not on the thread that held the apply lock.
        AppUpdateWindow.awaitGuardForTests()
        assertThat(AppUpdateWindow.closeReportPending(context)).isTrue()
        drainLock()
    }

    /** Lock's executors are single threads: a no-op behind the work queued above waits for it. */
    private fun drainLock() {
        val drained = CountDownLatch(2)
        Lock.applyIfNeededAsync(context, "drain", maxAgeMs = Long.MAX_VALUE) { drained.countDown() }
        Lock.recoverInstallAsync(context, "drain") { drained.countDown() }
        assertThat(drained.await(10, TimeUnit.SECONDS)).isTrue()
    }
}
