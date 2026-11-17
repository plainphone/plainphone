// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.update

import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.plainphone.app.FakeDevice
import org.plainphone.app.MemoryHiddenStore
import org.plainphone.app.PolicyApplier
import org.plainphone.app.PolicyConfig
import org.junit.Assert.*
import org.junit.Test

class UpdateTest {
    private val installed = ApkInfo("org.plainphone.app", 10, "1.0", setOf("cert"))

    @Test fun onlyStrictlyNewerApksWithTheSameSignerSetMayInstall() {
        val newer = installed.copy(versionCode = 11)
        assertEquals(UpdatePolicy.Verdict.Install, UpdatePolicy.check(installed, newer))
        for (apk in listOf(installed, installed.copy(versionCode = 9), newer.copy(packageName = "other"),
            newer.copy(certSha256 = setOf("other")), newer.copy(certSha256 = setOf("cert", "other")),
            newer.copy(certSha256 = emptySet()))) {
            assertTrue(UpdatePolicy.check(installed, apk) is UpdatePolicy.Verdict.Refuse)
        }
        assertTrue(UpdatePolicy.isUpToDate(installed, ReleaseInfo(9, "0.9", "https://example.org/app.apk", null)))
    }

    @Test fun truncatedDownloadIsRejected() {
        assertThrows(IOException::class.java) {
            AndroidUpdateHost.copyVerified(byteArrayOf(1, 2).inputStream(), ByteArrayOutputStream(), 3)
        }
    }

    private class Fixture : InstallLease.Store, InstallLease.Env {
        var saved = emptyMap<String, InstallLease.Lease>()
        var process = "first"
        var boot = 1
        var version = 10L
        var now = 100L
        private val device = FakeDevice().apply { addRestriction("no_install_apps") }
        private val applier = PolicyApplier(device, MemoryHiddenStore(), sdkInt = 35) {
            lease.allowsInstall(catalogApproved = it.installing != null)
        }
        val restricted get() = "no_install_apps" in device.restrictions
        val alarms = mutableListOf<Long>()
        override fun load() = saved
        override fun save(leases: Map<String, InstallLease.Lease>) { saved = leases }
        override fun nowMs() = now
        override fun processId() = process
        override fun bootCount() = boot
        override fun versionCode() = version
        override fun scheduleExpiry(holder: String, atMs: Long) { alarms += atMs }
        val lease: InstallLease = InstallLease(this, this) { _, _ -> applyPolicy() }
        @Synchronized
        fun applyPolicy() {
            val catalog = "org.example.approved".takeIf { lease.isOpen(InstallLease.CATALOG) }
            assertTrue(applier.applyInstallRestriction(PolicyConfig(installing = catalog)).ok)
        }
    }

    @Test fun failureRestoresRestriction() {
        val f = Fixture()
        assertThrows(IOException::class.java) {
            f.lease.hold("self-update") {
                assertFalse(f.restricted)
                throw IOException("install failed")
            }
        }
        assertTrue(f.restricted)
    }

    @Test fun catalogAndSelfUpdateCanFinishInEitherOrder() {
        for (first in listOf("self-update", "catalog")) {
            val f = Fixture()
            f.lease.acquire("catalog", 900_000)
            f.lease.acquire("self-update", 360_000)
            assertFalse(f.restricted)
            f.lease.release(first)
            assertFalse(f.restricted)
            f.lease.release(if (first == "catalog") "self-update" else "catalog")
            assertTrue(f.restricted)
        }
    }

    @Test fun catalogCanFinishWhileTheUpdateSessionIsStillRunning() {
        val f = Fixture()
        val inSession = CountDownLatch(1)
        val exitSession = CountDownLatch(1)
        val worker = Executors.newSingleThreadExecutor()
        f.lease.acquire(InstallLease.CATALOG, 900_000)
        try {
            val install = worker.submit {
                f.lease.hold(InstallLease.SELF_UPDATE) {
                    inSession.countDown()
                    assertTrue(exitSession.await(5, TimeUnit.SECONDS))
                }
            }
            assertTrue(inSession.await(5, TimeUnit.SECONDS))
            f.lease.release(InstallLease.CATALOG)
            assertFalse(f.restricted)
            exitSession.countDown()
            install.get(5, TimeUnit.SECONDS)
            assertTrue(f.restricted)
        } finally {
            exitSession.countDown()
            worker.shutdownNow()
        }
    }

    @Test fun expiryBootAndReplacementRecoverWhenCleanupNeverRan() {
        for (recovery in listOf<(Fixture) -> Unit>({ it.now = it.alarms.single() }, { it.boot++ }, { it.process = "restarted" }, { it.version++ })) {
            val f = Fixture()
            f.lease.acquire("self-update", 360_000)
            assertFalse(f.restricted)
            recovery(f)
            f.lease.recover()
            assertTrue(f.restricted)
        }
    }
}
