// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.Application
import android.location.Location
import android.location.LocationManager
import android.location.LocationRequest
import android.os.Handler
import android.os.HandlerThread
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.Duration
import java.util.concurrent.CountDownLatch
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowSystemClock

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29])
class LocationReaderTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val manager = shadowOf(context.getSystemService(LocationManager::class.java)!!)
    private val gps = LocationManager.GPS_PROVIDER
    private val network = LocationManager.NETWORK_PROVIDER

    @Before
    fun enableLocation() {
        manager.setLocationEnabled(true)
        manager.setProviderEnabled(gps, true)
        manager.setProviderEnabled(network, true)
    }

    @Test
    fun `a fresh accurate cached fix returns without a new request`() {
        val fix = fix(gps, 50f)
        manager.simulateLocation(fix)

        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> {
                LocationReader(context).current(precise = true, notBeforeMs = fix.time)
            }
            assertThat(result.get(2, TimeUnit.SECONDS)?.recordedAtMs).isEqualTo(fix.time)
            assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
            assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
        } finally {
            stopExecutor(executor)
        }
    }

    @Test
    fun `cache from before Find does not prevent an immediate lookup`() {
        val cached = fix(gps, 30f)
        manager.simulateLocation(cached)
        val requestedAt = cached.time + 1
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> {
                LocationReader(context).current(precise = true, notBeforeMs = requestedAt)
            }
            awaitRequests(gps, network)
            manager.simulateLocation(fix(network, 80f).apply { time = requestedAt })
            assertThat(result.get(1, TimeUnit.SECONDS)?.recordedAtMs).isEqualTo(requestedAt)
        } finally {
            stopExecutor(executor)
        }
    }

    @Test
    @Config(sdk = [31])
    fun `Find keeps listening when the provider repeats a pre-request position`() {
        val cached = fix(gps, 30f)
        manager.simulateLocation(cached)
        val requestedAt = cached.time + 1
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> {
                LocationReader(context).current(precise = true, notBeforeMs = requestedAt)
            }
            awaitRequests(gps, network)
            manager.simulateLocation(cached)
            ShadowSystemClock.advanceBy(Duration.ofSeconds(1))
            val live = fix(gps, 60f).apply { time = requestedAt + 1_000 }
            manager.simulateLocation(live)
            assertThat(result.get(1, TimeUnit.SECONDS)?.recordedAtMs).isEqualTo(live.time)
        } finally {
            stopExecutor(executor)
        }
    }

    @Test
    @Config(sdk = [31])
    fun `a fresh lookup ignores a cached position repeated by the provider`() {
        val cached = fix(gps, 30f)
        manager.simulateLocation(cached)
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> {
                LocationReader(context).current(precise = true, fresh = true)
            }
            awaitRequests(gps, network)
            manager.simulateLocation(cached)
            ShadowSystemClock.advanceBy(Duration.ofSeconds(1))
            val live = fix(gps, 60f)
            manager.simulateLocation(live)
            assertThat(result.get(1, TimeUnit.SECONDS)?.recordedAtMs).isEqualTo(live.time)
        } finally {
            stopExecutor(executor)
        }
    }

    @Test
    @Config(sdk = [31])
    fun `fused gets a 15 second head start and all providers share the 30 second budget`() {
        val fused = LocationManager.FUSED_PROVIDER
        manager.setProviderEnabled(fused, true)
        var now = 0L
        val second = TimeUnit.SECONDS.toNanos(1)
        val waits = mutableListOf<Long>()
        val reader = LocationReader(context, nanoTime = { now }, poll = { results, remaining ->
            waits += remaining
            when (now) {
                0L, 14 * second -> {
                    assertThat(manager.getLocationRequests(fused).single().durationMillis).isEqualTo(30_000L)
                    assertThat(manager.getLocationRequests(gps)).isEmpty()
                    assertThat(manager.getLocationRequests(network)).isEmpty()
                    if (now == 0L) {
                        now = 14 * second
                        manager.simulateLocation(fix(fused, 250f))
                    }
                }
                15 * second -> {
                    assertThat(manager.getLocationRequests(fused)).hasSize(1)
                    for (provider in listOf(gps, network)) {
                        assertThat(manager.getLocationRequests(provider).single().durationMillis).isEqualTo(15_000L)
                    }
                    now = 29 * second
                    manager.simulateLocation(fix(gps, 150f))
                    manager.simulateLocation(fix(network, 200f))
                }
            }
            results.poll() ?: run {
                now += remaining
                null
            }
        })

        assertThat(reader.current(precise = true)?.accuracyM).isEqualTo(150f)
        assertThat(now).isEqualTo(30 * second)
        assertThat(waits).containsExactly(15 * second, second, 15 * second, second, second).inOrder()
        assertThat(manager.getLocationRequests(fused)).isEmpty()
        assertThat(manager.getLocationRequests(gps)).isEmpty()
        assertThat(manager.getLocationRequests(network)).isEmpty()
    }

    @Test
    @Config(sdk = [31])
    fun `Find reads a fresh GPS cache without starting a lookup when fused cache is empty`() {
        val fused = LocationManager.FUSED_PROVIDER
        manager.setProviderEnabled(fused, true)
        val cached = fix(gps, 50f)
        manager.simulateLocation(cached)

        assertThat(AndroidSyncDevice(context).cachedPreciseLocation(cached.time)?.recordedAtMs)
            .isEqualTo(cached.time)
        assertThat(manager.getLocationRequests(fused)).isEmpty()
        assertThat(manager.getLocationRequests(gps)).isEmpty()
        assertThat(manager.getLocationRequests(network)).isEmpty()
    }

    @Test
    fun `last known returns the newest original time even when the cache is too old`() {
        val older = fix(gps, 30f)
        manager.simulateLocation(older)
        ShadowSystemClock.advanceBy(Duration.ofMinutes(5))
        val newest = fix(network, 150f).apply { time = older.time + 5 * 60_000L }
        manager.simulateLocation(newest)
        ShadowSystemClock.advanceBy(Duration.ofMinutes(40))

        val reader = LocationReader(context)
        assertThat(reader.current(precise = true, timeoutMs = 0)).isNull()
        assertThat(reader.lastKnown()?.recordedAtMs).isEqualTo(newest.time)
        assertThat(reader.lastKnown()?.accuracyM).isEqualTo(150f)
    }

    @Test
    fun `two unresponsive providers share the 30 second budget and are cancelled`() {
        var now = 0L
        val reader = LocationReader(context, nanoTime = { now }, poll = { _, remaining ->
            assertThat(manager.getLegacyLocationRequests(gps)).hasSize(1)
            assertThat(manager.getLegacyLocationRequests(network)).hasSize(1)
            now += remaining
            null
        })

        assertThat(reader.current(precise = true, timeoutMs = Long.MAX_VALUE)).isNull()
        assertThat(now).isEqualTo(TimeUnit.SECONDS.toNanos(30))
        assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
        assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
        assertThat(Thread.getAllStackTraces().keys.none { it.name == "plainphone-location" }).isTrue()
    }

    @Test
    @Config(sdk = [31])
    fun `always asks only fused and uses low power when fused is enabled`() {
        val fused = LocationManager.FUSED_PROVIDER
        manager.setProviderEnabled(fused, true)
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> { LocationReader(context).current(precise = false) }
            awaitRequests(fused)
            assertThat(manager.getLocationRequests(fused).single().quality).isEqualTo(LocationRequest.QUALITY_LOW_POWER)
            assertThat(manager.getLocationRequests(gps)).isEmpty()
            assertThat(manager.getLocationRequests(network)).isEmpty()

            manager.simulateLocation(fix(fused, 250f))
            assertThat(result.get(2, TimeUnit.SECONDS)?.accuracyM).isEqualTo(250f)
        } finally {
            stopExecutor(executor)
        }
    }

    @Test
    @Config(sdk = [31])
    fun `without a good fix the reader returns the most accurate of the two providers`() {
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> { LocationReader(context).current(precise = false) }
            awaitRequests(gps, network)
            assertThat(manager.getLocationRequests(gps).single().quality).isEqualTo(LocationRequest.QUALITY_LOW_POWER)
            assertThat(manager.getLocationRequests(network).single().quality).isEqualTo(LocationRequest.QUALITY_LOW_POWER)

            manager.simulateLocation(fix(network, 500f))
            manager.simulateLocation(fix(gps, 200f))
            assertThat(result.get(2, TimeUnit.SECONDS)?.accuracyM).isEqualTo(200f)
        } finally {
            stopExecutor(executor)
        }
    }

    @Test
    fun `cache-only Find rejects a fix at the two minute limit`() {
        val device = AndroidSyncDevice(context)
        val cached = fix(gps, 50f)
        manager.simulateLocation(cached)
        ShadowSystemClock.advanceBy(Duration.ofMillis(119_999))
        assertThat(device.cachedPreciseLocation(cached.time)?.recordedAtMs).isEqualTo(cached.time)

        ShadowSystemClock.advanceBy(Duration.ofMillis(1))
        assertThat(device.cachedPreciseLocation(cached.time)).isNull()
        assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
        assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
    }

    @Test
    fun `cache-only always reads a coarse fix and never starts a lookup`() {
        val device = AndroidSyncDevice(context)
        assertThat(device.cachedCoarseLocation()).isNull()

        val cached = fix(network, 900f)
        manager.simulateLocation(cached)
        ShadowSystemClock.advanceBy(Duration.ofMinutes(9))
        assertThat(device.cachedCoarseLocation()?.recordedAtMs).isEqualTo(cached.time)

        ShadowSystemClock.advanceBy(Duration.ofMinutes(1))
        assertThat(device.cachedCoarseLocation()).isNull()
        assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
        assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
    }

    @Test
    fun `always gets a GPS fix when the older network provider stays silent`() {
        var now = 0L
        val headStart = TimeUnit.MILLISECONDS.toNanos(500)
        val reader = LocationReader(context, nanoTime = { now }, poll = { results, remaining ->
            if (now == 0L) {
                assertThat(remaining).isEqualTo(headStart)
                assertThat(manager.getLegacyLocationRequests(network)).hasSize(1)
                assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
                now += remaining
                null
            } else {
                assertThat(remaining).isEqualTo(TimeUnit.SECONDS.toNanos(30) - headStart)
                assertThat(manager.getLegacyLocationRequests(gps)).hasSize(1)
                manager.simulateLocation(fix(gps, 75f))
                // Bound the wait for the real Android 10 callback thread, independently of the lookup clock.
                checkNotNull(results.poll(1, TimeUnit.SECONDS)) { "GPS callback was not delivered" }
            }
        })

        assertThat(reader.current(precise = false)?.accuracyM).isEqualTo(75f)
        assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
    }

    @Test
    fun `a cache entry with a recent wall time but old elapsed time is ignored`() {
        val stale = fix(gps, 50f)
        ShadowSystemClock.advanceBy(Duration.ofMinutes(10))
        stale.time = System.currentTimeMillis()
        manager.simulateLocation(stale)
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> { LocationReader(context).current(precise = true) }
            awaitRequests(gps, network)
            manager.simulateLocation(fix(network, 90f))
            assertThat(result.get(1, TimeUnit.SECONDS)?.accuracyM).isEqualTo(90f)
        } finally {
            stopExecutor(executor)
        }
    }

    @Test
    fun `the first precise fix cancels the silent provider`() {
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> { LocationReader(context).current(precise = true) }
            awaitRequests(gps, network)
            manager.simulateLocation(fix(network, 100f))
            assertThat(result.get(1, TimeUnit.SECONDS)?.accuracyM).isEqualTo(100f)
            assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
            assertThat(Thread.getAllStackTraces().keys.none { it.name == "plainphone-location" }).isTrue()
        } finally {
            stopExecutor(executor)
        }
    }

    @Test
    @Config(sdk = [31])
    fun `precise lookup accepts a better update from the same provider`() {
        var sent = false
        val reader = LocationReader(context, nanoTime = { 0L }, poll = { results, _ ->
            if (!sent) {
                sent = true
                manager.simulateLocation(fix(network, 150f))
                manager.simulateLocation(fix(gps, 200f))
                manager.simulateLocation(fix(gps, 60f))
            }
            results.poll()
        })

        assertThat(reader.current(precise = true)?.accuracyM).isEqualTo(60f)
        assertThat(manager.getLocationRequests(gps)).isEmpty()
        assertThat(manager.getLocationRequests(network)).isEmpty()
    }

    @Test
    fun `a precise lookup keeps a 150 m fix when GPS times out`() {
        var now = 0L
        val reader = LocationReader(context, nanoTime = { now }, poll = { results, remaining ->
            if (now == 0L) {
                assertThat(manager.getLegacyLocationRequests(gps)).hasSize(1)
                assertThat(manager.getLegacyLocationRequests(network)).hasSize(1)
                now = TimeUnit.MILLISECONDS.toNanos(100)
                manager.simulateLocation(fix(network, 150f))
                checkNotNull(results.poll(1, TimeUnit.SECONDS)) { "Network callback was not delivered" }
            } else {
                now += remaining
                null
            }
        })

        assertThat(reader.current(precise = true, timeoutMs = 1_000)?.accuracyM).isEqualTo(150f)
        assertThat(now).isEqualTo(TimeUnit.SECONDS.toNanos(1))
        assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
        assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
    }

    @Test
    fun `lookup returns at expiry even when its callback thread is still busy`() {
        manager.setProviderEnabled(gps, false)
        val callbackEntered = CountDownLatch(1)
        val releaseCallback = CountDownLatch(1)
        var callbackThread: HandlerThread? = null
        var now = 0L
        val reader = LocationReader(context, nanoTime = { now }, poll = { _, remaining ->
            val thread = Thread.getAllStackTraces().keys.filterIsInstance<HandlerThread>()
                .single { it.name == "plainphone-location" }
            callbackThread = thread
            check(Handler(thread.looper).post {
                callbackEntered.countDown()
                releaseCallback.await()
            })
            check(callbackEntered.await(1, TimeUnit.SECONDS))
            now += remaining
            null
        })
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> { reader.current(precise = true) }
            assertThat(result.get(2, TimeUnit.SECONDS)).isNull()
            assertThat(now).isEqualTo(TimeUnit.SECONDS.toNanos(30))
            assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
        } finally {
            releaseCallback.countDown()
            stopExecutor(executor)
            callbackThread?.join(1_000)
            check(callbackThread?.isAlive != true) { "Location callback thread did not stop" }
        }
    }

    private fun stopExecutor(executor: ExecutorService) {
        executor.shutdownNow()
        check(executor.awaitTermination(5, TimeUnit.SECONDS)) { "Location lookup executor did not stop" }
    }

    private fun awaitRequests(vararg providers: String) {
        val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
        while (System.nanoTime() < deadline && providers.any { manager.getLegacyLocationRequests(it).isEmpty() }) {
            Thread.sleep(10)
        }
        for (provider in providers) {
            assertThat(manager.getLegacyLocationRequests(provider)).hasSize(1)
        }
    }

    private fun fix(provider: String, meters: Float) = Location(provider).apply {
        time = System.currentTimeMillis()
        elapsedRealtimeNanos = SystemClock.elapsedRealtimeNanos()
        accuracy = meters
    }
}
