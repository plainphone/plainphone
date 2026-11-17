// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit.SECONDS
import org.junit.Assert.*
import org.junit.Test
import org.plainphone.app.update.InstallLease.Companion.CATALOG
import org.plainphone.app.update.InstallLease.Companion.SELF_UPDATE

class InstallLeaseTest {
    private class Fixture : InstallLease.Store, InstallLease.Env {
        var now = 100L
        var process = "first"
        var restricted = true
        var saved = emptyMap<String, InstallLease.Lease>()
        val reports = mutableListOf<Long>()
        var arming = {}
        var relock = { restricted = true }
        override fun load() = saved
        override fun save(leases: Map<String, InstallLease.Lease>) { saved = leases }
        override fun retire(leases: Map<String, InstallLease.Lease>, overrunSeconds: Long?) {
            save(leases)
            overrunSeconds?.let(reports::add)
        }
        override fun nowMs() = now
        override fun processId() = process
        override fun bootCount() = 1
        override fun versionCode() = 0L
        override fun scheduleExpiry(holder: String, atMs: Long) = Unit
        override fun persistWithWatchdog(holder: String, atMs: Long, persist: () -> Unit) {
            arming()
            persist()
        }

        fun lease() = InstallLease(this, this, { relock() }, { !restricted }, { true }) { _, _ ->
            error("Unexpected full policy apply")
        }
    }

    @Test fun sameHolderBeginsWhileTheLateClearReturns() {
        val f = Fixture()
        val lease = f.lease()
        val clearing = CountDownLatch(1)
        val returnClear = CountDownLatch(1)
        val arming = CountDownLatch(1)
        val finishArming = CountDownLatch(1)
        val workers = Executors.newFixedThreadPool(2)
        lease.begin(CATALOG, 10_000)
        try {
            val clear = workers.submit {
                lease.clearIfAllowed(true) {
                    clearing.countDown()
                    assertTrue(returnClear.await(5, SECONDS))
                    f.restricted = false
                }
            }
            assertTrue(clearing.await(5, SECONDS))
            f.now += 55_000
            lease.recover()
            // Simulate a relock that took effect but threw. The clear's observed
            // overrun must survive both the exception and a competing begin.
            f.relock = {
                f.restricted = true
                error("Relock failed after writing")
            }
            f.arming = {
                arming.countDown()
                assertTrue(finishArming.await(5, SECONDS))
            }
            val begin = workers.submit {
                f.lease().begin(CATALOG, 10_000)
            }
            assertTrue(arming.await(5, SECONDS))
            returnClear.countDown()
            assertThrows(java.util.concurrent.ExecutionException::class.java) { clear.get(5, SECONDS) }
            f.relock = { f.restricted = true }
            finishArming.countDown()
            begin.get(5, SECONDS)
            assertEquals(listOf(45L), f.reports)
            assertTrue(lease.isOpen(CATALOG))
            assertTrue(f.restricted)
        } finally {
            returnClear.countDown()
            finishArming.countDown()
            workers.shutdownNow()
        }
    }

    @Test fun watchdogRelocksAtTheDeadlineAndWaitsToRetireUntilClearCompletes() {
        val f = Fixture()
        val lease = f.lease()
        val clearing = CountDownLatch(1)
        val returnClear = CountDownLatch(1)
        val worker = Executors.newSingleThreadExecutor()
        lease.begin(CATALOG, 10_000)
        try {
            val clear = worker.submit {
                lease.clearIfAllowed(true) {
                    clearing.countDown()
                    assertTrue(returnClear.await(5, SECONDS))
                    f.restricted = false
                }
            }
            assertTrue(clearing.await(5, SECONDS))
            f.now += 10_000
            f.restricted = false
            lease.recover()
            assertTrue(f.restricted)
            assertFalse(lease.isOpen(CATALOG))
            assertTrue(lease.hasMarkers())
            assertThrows(IllegalStateException::class.java) { lease.begin(SELF_UPDATE, 90_000) }
            f.now += 45_000
            returnClear.countDown()
            clear.get(5, SECONDS)
            assertTrue(f.restricted)
            assertFalse(lease.hasMarkers())
            assertEquals(listOf(45L), f.reports)
        } finally {
            returnClear.countDown()
            worker.shutdownNow()
        }
    }

    @Test fun beginAfterProcessDeathReportsTheInvalidatedDeadlineBeforeOpening() {
        val f = Fixture()
        val lease = f.lease()
        lease.begin(CATALOG, 10_000)
        f.restricted = false
        assertTrue(lease.invalidate(CATALOG))
        f.process = "replacement"
        f.now += 15_000
        f.lease().begin(CATALOG, 10_000)
        assertEquals(listOf(5L), f.reports)
        assertTrue(f.restricted)
        assertTrue(f.lease().isOpen(CATALOG))
    }
}
