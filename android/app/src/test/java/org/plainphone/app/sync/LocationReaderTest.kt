// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.Application
import android.location.Location
import android.location.LocationManager
import android.location.LocationRequest
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

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
            val result = executor.submit<LocationFix?> { LocationReader(context).current(precise = true) }
            assertThat(result.get(2, TimeUnit.SECONDS)?.recordedAtMs).isEqualTo(fix.time)
            assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
            assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
        } finally {
            executor.shutdownNow()
        }
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
        accuracy = meters
    }
}
