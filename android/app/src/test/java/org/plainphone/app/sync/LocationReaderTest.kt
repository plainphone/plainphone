// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.Application
import android.location.Location
import android.location.LocationManager
import android.location.LocationRequest
import android.os.SystemClock
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.Duration
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
            executor.shutdownNow()
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
            executor.shutdownNow()
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
            executor.shutdownNow()
        }
    }

    @Test
    @Config(sdk = [31])
    fun `an unresponsive fused provider leaves time for GPS and network`() {
        val fused = LocationManager.FUSED_PROVIDER
        manager.setProviderEnabled(fused, true)
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> {
                LocationReader(context).current(precise = true, timeoutMs = 3_000)
            }
            awaitRequests(fused)
            awaitRequests(gps, network)
            manager.simulateLocation(fix(gps, 75f))
            assertThat(result.get(1, TimeUnit.SECONDS)?.accuracyM).isEqualTo(75f)
        } finally {
            executor.shutdownNow()
        }
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
        val executor = Executors.newSingleThreadExecutor()
        try {
            val deadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(32)
            val result = executor.submit<LocationFix?> { LocationReader(context).current(precise = true) }
            awaitRequests(gps, network)
            val remaining = deadline - System.nanoTime()
            assertThat(result.get(remaining, TimeUnit.NANOSECONDS)).isNull()
            assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
            assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
        } finally {
            executor.shutdownNow()
        }
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
            executor.shutdownNow()
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
            executor.shutdownNow()
        }
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
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> { LocationReader(context).current(precise = false) }
            awaitRequests(gps, network)
            manager.simulateLocation(fix(gps, 75f))
            assertThat(result.get(1, TimeUnit.SECONDS)?.accuracyM).isEqualTo(75f)
            assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
        } finally {
            executor.shutdownNow()
        }
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
            executor.shutdownNow()
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
        } finally {
            executor.shutdownNow()
        }
    }

    @Test
    fun `a precise lookup keeps a 150 m fix when GPS times out`() {
        val executor = Executors.newSingleThreadExecutor()
        try {
            val result = executor.submit<LocationFix?> {
                LocationReader(context).current(precise = true, timeoutMs = 1_000)
            }
            awaitRequests(gps, network)
            manager.simulateLocation(fix(network, 150f))
            assertThat(result.get(2, TimeUnit.SECONDS)?.accuracyM).isEqualTo(150f)
            assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
        } finally {
            executor.shutdownNow()
        }
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
