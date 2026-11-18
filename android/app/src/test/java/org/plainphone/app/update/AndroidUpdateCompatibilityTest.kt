// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.pm.PackageInfo
import android.content.pm.Signature
import android.os.PowerManager
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestWorkerBuilder
import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit.SECONDS
import java.util.concurrent.atomic.AtomicBoolean
import org.plainphone.app.sync.PlainphoneApi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], application = android.app.Application::class)
class AndroidUpdateCompatibilityTest {
    @Suppress("DEPRECATION")
    @Test fun android10ArchiveUsesLegacySignersWhenSigningInfoIsMissing() {
        val info = PackageInfo().apply {
            packageName = "org.plainphone.app"
            signatures = arrayOf(Signature(byteArrayOf(1)), Signature(byteArrayOf(2)))
        }
        assertEquals(
            setOf(
                "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
                "dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986",
            ),
            AndroidUpdateHost.apkInfo(info).certSha256,
        )
        assertTrue(AndroidUpdateHost.apkInfo(info, sdk = 30).certSha256.isEmpty())
    }

    @Test fun persistedWorkerReconcilesInterruptedInstallBeforeCheckingForUpdates() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val store = PrefsUpdateStateStore(context)
        store.installingVersionCode = Long.MAX_VALUE
        store.lastCheckMs = System.currentTimeMillis() // The scheduled release check itself is not due.
        val worker = TestWorkerBuilder<UpdateWorker>(context, Executor { it.run() }).build()

        // Robolectric can reuse static state across tests. This worker represents a cold process.
        val wasReconciled = ReflectionHelpers.getStaticField<Boolean>(SelfUpdate::class.java, "reconciledOnStart")
        ReflectionHelpers.setStaticField(SelfUpdate::class.java, "reconciledOnStart", false)
        try {
            assertEquals(ListenableWorker.Result.success(), worker.doWork())
            assertEquals(0L, store.installingVersionCode)
            assertEquals(UpdateErrorCode.INSTALL_FAILED, store.report?.errorCode)
        } finally {
            ReflectionHelpers.setStaticField(SelfUpdate::class.java, "reconciledOnStart", wasReconciled)
        }
    }

    @Test fun missingReleaseMetadataDoesNotReadTheErrorBody() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        var disconnected = false
        val connection = object : HttpURLConnection(URL("https://example.org/download/android/latest.json")) {
            override fun connect() = Unit
            override fun usingProxy() = false
            override fun disconnect() { disconnected = true }
            override fun getResponseCode() = HttpURLConnection.HTTP_NOT_FOUND
            override fun getErrorStream(): InputStream = error("fallback must not wait for the error body")
        }
        assertNull(AndroidUpdateHost(context).fetchLatest(connection))
        assertTrue(disconnected)
    }

    @Suppress("DEPRECATION")
    @Test fun screenOffPreventsPollingEvenWhenWorkWasAlreadyQueued() {
        val power = ApplicationProvider.getApplicationContext<android.app.Application>()
            .getSystemService(PowerManager::class.java)!!
        val tasks = ArrayDeque<Runnable>()
        var polls = 0
        val listener = InteractiveUpdatePoll({ power.isInteractive }, { tasks.addLast(it) }) {
            polls++
        }
        shadowOf(power).setIsInteractive(true)
        listener.wake()
        shadowOf(power).setIsInteractive(false)
        listener.sleep()
        tasks.removeFirst().run()
        listener.wake()
        assertTrue(tasks.isEmpty())
        assertEquals(0, polls)
        shadowOf(power).setIsInteractive(true)
        listener.wake()
        tasks.removeFirst().run()
        assertEquals(1, polls)
    }

    @Test fun screenOffDisconnectsAnInFlightUpdateRequest() {
        val interactive = AtomicBoolean(true)
        val waitingForResponse = CountDownLatch(1)
        val disconnected = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val executor = Executors.newSingleThreadExecutor()
        val api = PlainphoneApi("https://example.org") { url ->
            object : HttpURLConnection(url) {
                override fun connect() = Unit
                override fun usingProxy() = false
                override fun disconnect() = disconnected.countDown()
                override fun getResponseCode(): Int {
                    waitingForResponse.countDown()
                    disconnected.await()
                    throw IOException("disconnected")
                }
            }
        }
        try {
            val listener = InteractiveUpdatePoll(interactive::get, executor) { session ->
                try {
                    api.waitForUpdateRequest("token", 0, session.cancellation)
                } catch (_: IOException) {
                    finished.countDown()
                }
            }
            listener.wake()
            assertTrue(waitingForResponse.await(5, SECONDS))
            interactive.set(false)
            listener.sleep()
            assertTrue("The HTTP call should be disconnected on screen-off", finished.await(5, SECONDS))
        } finally {
            disconnected.countDown()
            executor.shutdown()
            assertTrue(executor.awaitTermination(5, SECONDS))
        }
    }

    @Test fun conflictIsRetried() {
        assertTrue(UpdateRequestListener.shouldRetryHttpStatus(409))
    }
}
