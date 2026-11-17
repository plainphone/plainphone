// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.Application
import android.location.Location
import android.location.LocationManager
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
        val fix = Location(gps).apply {
            time = System.currentTimeMillis()
            accuracy = 50f
        }
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
            val result = executor.submit<LocationFix?> { LocationReader(context).current(precise = true) }
            val registrationDeadline = System.nanoTime() + TimeUnit.SECONDS.toNanos(2)
            while (System.nanoTime() < registrationDeadline &&
                (manager.getLegacyLocationRequests(gps).isEmpty() || manager.getLegacyLocationRequests(network).isEmpty())
            ) {
                Thread.sleep(10)
            }
            assertThat(manager.getLegacyLocationRequests(gps)).hasSize(1)
            assertThat(manager.getLegacyLocationRequests(network)).hasSize(1)
            val remaining = registrationDeadline + TimeUnit.SECONDS.toNanos(30) - System.nanoTime()
            assertThat(result.get(remaining, TimeUnit.NANOSECONDS)).isNull()
            assertThat(manager.getLegacyLocationRequests(gps)).isEmpty()
            assertThat(manager.getLegacyLocationRequests(network)).isEmpty()
        } finally {
            executor.shutdownNow()
        }
    }
}
