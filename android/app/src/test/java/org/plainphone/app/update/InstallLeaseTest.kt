// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.FutureTask
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
        var prepare = {}
        var arming = {}
        var failWrites = false
        var relock = { restricted = true }
        override fun load() = saved
        override fun save(leases: Map<String, InstallLease.Lease>) {
            check(!failWrites) { "Storage unavailable" }
            saved = leases
        }
        override fun retire(leases: Map<String, InstallLease.Lease>, overrunSeconds: Long?) {
            save(leases)
            overrunSeconds?.let(reports::add)
        }
        override fun nowMs() = now
        override fun processId() = process
        override fun bootCount() = 1
        override fun versionCode() = 0L
        override fun prepareExpiry(holder: String, atMs: Long) = prepare()
        override fun scheduleExpiry(holder: String, atMs: Long) = Unit
        override fun persistWithWatchdog(holder: String, atMs: Long, persist: () -> Unit) {
            arming()
            persist()
        }

        fun lease(relockCatalogAccounts: () -> Unit = {}) = InstallLease(
            this, this, { relock() }, { !restricted }, { true },
            relockCatalogAccounts = relockCatalogAccounts,
        ) { _, _ -> error("Unexpected full policy apply") }
    }

    @Test fun watchdogRelocksWhenStorageFailsAndRetryReportsTheObservedOverrun() {
        val f = Fixture()
        val lease = f.lease()
        lease.begin(CATALOG, 10_000)
        val original = f.saved
        f.restricted = false
        f.now += 55_000
        f.failWrites = true

        assertThrows(IllegalStateException::class.java) { lease.recover() }
        assertTrue(f.restricted)
        assertEquals(original, f.saved)
        assertTrue(f.reports.isEmpty())

        f.failWrites = false
        f.now += 10_000
        f.lease().recover()
        assertEquals(listOf(45L), f.reports)
        assertFalse(lease.hasMarkers())
    }

    @Test fun expiredLegacyCatalogRestoresAccountRestrictionDuringSelfUpdate() {
        val f = Fixture()
        var accountsRestricted = false
        val lease = f.lease { accountsRestricted = true }
        lease.begin(CATALOG, 10_000)
        lease.begin(SELF_UPDATE, 60_000)
        f.restricted = false
        f.now += 10_000

        lease.recover()

        assertTrue(accountsRestricted)
        assertFalse(f.restricted)
        assertEquals(setOf(SELF_UPDATE), f.saved.keys)
    }

    @Test fun catalogAccountClosePreservesSuccessWhileAnotherClearFinishes() {
        val f = Fixture()
        val outcomes = mutableListOf<Pair<String, Boolean>>()
        val lease = InstallLease(f, f, onCatalogAccountsClosed = { id, success ->
            outcomes.add(id to success)
        }) { _, _ -> error("Unexpected full policy apply") }
        lease.begin(CATALOG, 60_000)
        val request = lease.armCatalogAccounts(checkNotNull(lease.catalogId()), f.now + 30_000)

        assertTrue(lease.clearIfAllowed(true) {
            lease.finishCatalogAccounts(request)
            assertTrue(outcomes.isEmpty())
        })

        assertEquals(listOf(request to true), outcomes)
    }

    @Test fun changingCatalogTargetKeepsTheOriginalWatchdogAndDeadline() {
        val f = Fixture()
        val lease = f.lease()
        lease.begin(CATALOG, 10_000)
        val original = f.saved
        f.now += 5_000
        f.prepare = { error("Must reuse the scheduled backup") }
        f.arming = { error("Must reuse the foreground watchdog") }

        f.lease().begin(CATALOG, 90_000)

        assertEquals(original, f.saved)
        f.now += 5_000
        assertFalse(lease.isOpen(CATALOG))
    }

    @Test fun sameHolderBeginsWhileTheLateClearReturns() {
        val f = Fixture()
        val lease = f.lease()
        val clearing = CountDownLatch(1)
        val returnClear = CountDownLatch(1)
        val relocking = CountDownLatch(1)
        val finishRelock = CountDownLatch(1)
        val worker = Executors.newSingleThreadExecutor()
        val begin = FutureTask { f.lease().begin(CATALOG, 10_000) }
        val contender = Thread(begin, "competing catalog begin")
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
            f.now += 55_000
            lease.recover()
            f.relock = {
                relocking.countDown()
                assertTrue(finishRelock.await(5, SECONDS))
                f.restricted = true
            }
            f.prepare = { assertEquals(listOf(45L), f.reports) }

            returnClear.countDown()
            assertTrue(relocking.await(5, SECONDS))
            contender.start()
            // Confirm begin attempts to enter the monitor before letting recovery finish.
            val deadline = System.nanoTime() + SECONDS.toNanos(5)
            while (contender.state != Thread.State.BLOCKED && !begin.isDone && System.nanoTime() < deadline) {
                Thread.yield()
            }
            assertEquals(Thread.State.BLOCKED, contender.state)
            finishRelock.countDown()

            clear.get(5, SECONDS)
            begin.get(5, SECONDS)
            assertEquals(listOf(45L), f.reports)
            assertTrue(lease.isOpen(CATALOG))
            assertTrue(f.restricted)
        } finally {
            returnClear.countDown()
            finishRelock.countDown()
            worker.shutdownNow()
            contender.join(5_000)
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
