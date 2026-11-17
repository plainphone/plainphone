// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.update

import java.io.File
import java.net.HttpURLConnection
import java.net.URL
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
import org.junit.Rule
import org.junit.rules.TemporaryFolder

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

    @get:Rule val files = TemporaryFolder()

    @Test fun interruptedDownloadNeverReachesTheInstallerAndLeavesNoFile() {
        val f = Fixture()
        val dir = files.newFolder()
        val connection = object : HttpURLConnection(URL("https://example.org/app.apk")) {
            override fun getResponseCode() = 200
            override fun getContentLengthLong() = 3L
            override fun getInputStream() = byteArrayOf(1, 2).inputStream()
            override fun disconnect() = Unit
            override fun usingProxy() = false
            override fun connect() = Unit
        }
        val store = object : UpdateStateStore {
            override var installingVersionCode = 0L
            override var lastCheckMs = 0L
            override var handledRequestMs = 0L
            override var report: UpdateReport? = null
        }
        val host = object : UpdateHost {
            override fun nowMs() = 100L
            override fun installed() = installed
            override fun isDeviceOwner() = true
            override fun inMaintenance() = false
            override fun downloadAllowed() = true
            override fun fetchLatest(): ReleaseInfo? = null
            override fun fallbackUrl() = "https://example.org/app.apk"
            override fun download(url: String, sha256: String?) = AndroidUpdateHost.downloadApk(dir, sha256) { connection }
            override fun inspect(apk: File): ApkInfo = error("partial APK reached inspection")
            override fun install(apk: File): String? = error("partial APK reached installation")
            override fun promptUpdate(latest: ReleaseInfo) = error("unexpected light-mode prompt")
        }
        val outcome = SelfUpdater(host, store).run(force = true)
        assertTrue((outcome as SelfUpdater.Outcome.Failed).why.contains("after 2 of 3 bytes"))
        assertEquals(SelfUpdater.STATE_FAILED, store.report?.state)
        assertTrue(dir.listFiles()!!.isEmpty())
        assertTrue(f.alarms.isEmpty())
        assertTrue(f.restricted)
    }

    @Test fun verifiedApkReachesTheInstallerWithTheRestrictionStillSet() {
        val f = Fixture()
        val dir = files.newFolder()
        val store = object : UpdateStateStore {
            override var installingVersionCode = 0L
            override var lastCheckMs = 0L
            override var handledRequestMs = 0L
            override var report: UpdateReport? = null
        }
        val host = object : UpdateHost {
            override fun nowMs() = 100L
            override fun installed() = installed
            override fun isDeviceOwner() = true
            override fun inMaintenance() = false
            override fun downloadAllowed() = true
            override fun fetchLatest(): ReleaseInfo? = null
            override fun fallbackUrl() = "https://example.org/app.apk"
            override fun download(url: String, sha256: String?) = File(dir, "update.apk").apply { writeText("verified by the fake inspector") }
            override fun inspect(apk: File): ApkInfo = installed.copy(versionCode = installed.versionCode + 1)
            override fun install(apk: File): String? {
                assertTrue(f.restricted)
                return null
            }
            override fun promptUpdate(latest: ReleaseInfo) = error("unexpected light-mode prompt")
        }
        val outcome = SelfUpdater(host, store).run(force = true)
        assertTrue(outcome is SelfUpdater.Outcome.Installed)
        assertTrue(dir.listFiles()!!.isEmpty())
        assertTrue(f.alarms.isEmpty())
        assertTrue(f.restricted)
    }

    @Test fun manualUpdateClearsPromptWhenItsTargetWasInstalled() {
        val prompt = UpdateReport(SelfUpdater.STATE_PROMPTED, null, 123L, "1.1", 11L)
        assertEquals(prompt, prompt.reconcileInstalled(installed))
        val updated = prompt.reconcileInstalled(installed.copy(versionCode = 12, versionName = "1.2"))
        assertEquals(SelfUpdater.STATE_UP_TO_DATE, updated.state)
        assertEquals("1.2", updated.latestVersionName)
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
        var alarmAvailable = true
        override fun load() = saved
        override fun save(leases: Map<String, InstallLease.Lease>) { saved = leases }
        override fun nowMs() = now
        override fun processId() = process
        override fun bootCount() = boot
        override fun versionCode() = version
        override fun scheduleExpiry(holder: String, atMs: Long) {
            check(alarmAvailable)
            alarms += atMs
        }
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

    @Test fun replacementInvalidatesBothInstallWindows() {
        val f = Fixture()
        f.lease.acquire(InstallLease.CATALOG, 900_000)
        f.lease.acquire(InstallLease.SELF_UPDATE, 360_000)
        f.process = "replacement"
        f.version++
        f.lease.recover()
        assertFalse(f.lease.isOpen(InstallLease.SELF_UPDATE))
        assertFalse(f.lease.isOpen(InstallLease.CATALOG))
        assertTrue(f.restricted)
    }

    @Test fun noRestrictionIsLiftedWhenTheWatchdogCannotBeArmed() {
        val f = Fixture().apply { alarmAvailable = false }
        assertThrows(IllegalStateException::class.java) {
            f.lease.hold(InstallLease.SELF_UPDATE) { error("install started without a watchdog") }
        }
        assertTrue(f.restricted)
        assertTrue(f.saved.isEmpty())
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
