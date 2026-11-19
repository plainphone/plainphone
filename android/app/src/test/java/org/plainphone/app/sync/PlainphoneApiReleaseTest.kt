// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.Application
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.work.ListenableWorker
import androidx.work.NetworkType
import androidx.work.testing.TestWorkerBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.Executor
import java.util.concurrent.TimeUnit
import org.plainphone.app.ConfigStore
import org.plainphone.app.R
import org.plainphone.app.light.GuardService
import org.plainphone.app.light.LightAdminReceiver
import org.plainphone.app.light.vpn.PlainphoneVpnService
import org.plainphone.app.light.LightRelease
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.SelfApprovalChoices
import org.plainphone.app.light.SelfApprovalQr
import org.plainphone.app.light.UndoSetupAction
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadow.api.Shadow
import org.robolectric.util.ReflectionHelpers
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

/** Release and setup undo against a local server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PlainphoneApiReleaseTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var server: HttpServer
    @Volatile private var answer = 204
    @Volatile private var responseBody = """{"error":"x"}"""
    // The server answers on its own threads; the test reads these on the test thread.
    private val seen = java.util.Collections.synchronizedList(mutableListOf<Triple<String, String, String?>>())
    private val completionReports = java.util.Collections.synchronizedList(mutableListOf<JSONObject>())
    private lateinit var serverThreads: java.util.concurrent.ExecutorService

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        serverThreads = java.util.concurrent.Executors.newCachedThreadPool()
        server.executor = serverThreads
        server.createContext("/") { ex ->
            try {
                seen += Triple(ex.requestMethod, ex.requestURI.path, ex.requestHeaders.getFirst("Authorization"))
                val request = ex.requestBody.readBytes()
                val status = if (ex.requestURI.path == "/api/device/setup-completion") {
                    completionReports += JSONObject(request.decodeToString())
                    if (answer == 204) 200 else answer
                } else answer
                val body = if (status == 204) ByteArray(0) else responseBody.toByteArray()
                // Every answer ends its connection, so no client can pick up a socket the server has dropped.
                ex.responseHeaders.set("Connection", "close")
                ex.sendResponseHeaders(status, if (status == 204) -1 else body.size.toLong())
                if (status != 204) ex.responseBody.use { it.write(body) }
            } catch (e: Throwable) {
                // A handler that dies drops the connection and the client only sees a SocketException.
                // Say what went wrong here instead.
                System.err.println("test server failed: $e")
                runCatching { ex.sendResponseHeaders(500, -1) }
            } finally {
                ex.close()
            }
        }
        server.start()
    }

    @After
    fun stop() {
        server.stop(0)
        serverThreads.shutdownNow()
    }

    // HttpURLConnection pools keep-alive sockets for the whole JVM, keyed by host and port. A socket
    // left over from an earlier test's server must never be reused by this one.
    private fun api() = PlainphoneApi("http://127.0.0.1:${server.address.port}") { url ->
        (url.openConnection() as java.net.HttpURLConnection).also { it.setRequestProperty("Connection", "close") }
    }

    @Test
    fun `an invalid setup key is distinct from a rejected enrollment token`() {
        answer = 400
        responseBody = """{"error":"invalid setup key"}"""
        assertThat(api().enroll("pp_e_test", "install-id-123456", emptyMap())).isEqualTo(EnrollResult.InvalidKey)
        responseBody = """{"error":"invalid input","issues":[{"path":"key.trustedEmail","message":"Invalid email"}]}"""
        assertThat(api().enroll("pp_e_test", "install-id-123456", emptyMap())).isEqualTo(EnrollResult.InvalidKey)
        answer = 410
        assertThat(api().enroll("pp_e_test", "install-id-123456", emptyMap())).isEqualTo(EnrollResult.Rejected)
    }

    @Test
    fun `approval choices and QR show the requested limit`() {
        val shorter = "Instagram: 15 → 30 min a day"
        val longer = "Instagram: 15 → 60 min a day"
        responseBody = """{"changes":[
            {"id":"short","summary":{"en":"$shorter","da":"$shorter"}},
            {"id":"long","summary":{"en":"$longer","da":"$longer"}}
        ]}"""
        answer = 200
        val requests = api().approvalRequests("test-token", "en")
        val qrUrl = "http://127.0.0.1/approvals#code=phone.long.expiry.nonce"
        responseBody = """{"url":"$qrUrl","summary":{"en":"$longer","da":"$longer"}}"""

        var selectedId: String? = null
        val shownQr = mutableStateOf<PlainphoneApi.ApprovalQr?>(null)
        compose.setContent {
            Column {
                val qr = shownQr.value
                if (qr == null) SelfApprovalChoices(requests) { selectedId = it }
                else SelfApprovalQr(qr.url, qr.summary)
            }
        }
        compose.onNodeWithText(shorter).assertIsDisplayed()
        compose.onNodeWithText(longer).assertIsDisplayed()
        compose.onNodeWithText(longer).performClick()
        assertThat(selectedId).isEqualTo("long")
        val qr = api().approvalQr("test-token", checkNotNull(selectedId), "en")
        compose.runOnIdle { shownQr.value = qr }
        compose.onNodeWithText(longer).assertIsDisplayed()
        compose.onNodeWithText(shorter).assertDoesNotExist()
        assertThat(seen.map { it.first }).containsExactly("GET", "POST").inOrder()
    }

    @Test
    @Config(shadows = [PairedStore::class, GuardShadow::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `undo switches off locally without contacting the server and queues one report`() {
        val context = completeSetup()
        SyncStore(context, FakeSecretBox()).savePaired("test-phone", "test-token")
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        val admin = LightAdminReceiver.component(context)
        shadowOf(policy).setActiveAdmin(admin)
        Settings.Secure.putString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ComponentName(context, GuardService::class.java).flattenToString())
        Settings.Secure.putInt(context.contentResolver, Settings.Secure.ACCESSIBILITY_ENABLED, 1)
        val vpn = Intent(context, PlainphoneVpnService::class.java)
        context.startService(vpn)
        compose.setContent { UndoSetupAction(compose.activity, 0) }
        compose.onNodeWithText(context.getString(R.string.setup_undo)).assertIsDisplayed().performClick()

        compose.waitUntil(5_000) { LightRelease.isReleased(context) }
        val manager = WorkManager.getInstance(context)
        fun reports() = manager.getWorkInfosForUniqueWork("plainphone-sync-finish-undo").get(5, TimeUnit.SECONDS)
        compose.waitUntil(5_000) { reports().size == 1 }
        assertThat(reports().single().constraints.requiredNetworkType).isEqualTo(NetworkType.CONNECTED)
        assertThat(shadowOf(context as Application).nextStoppedService?.component).isEqualTo(vpn.component)
        assertThat(policy.isAdminActive(admin)).isTrue()
        val guard = Robolectric.buildService(GuardService::class.java).create().get()
        ReflectionHelpers.callInstanceMethod<Unit>(guard, "onServiceConnected")
        assertThat(Shadow.extract<GuardShadow>(guard).disabled).isTrue()
        assertThat(seen).isEmpty()

        answer = 503
        val worker = TestWorkerBuilder<SyncWorker>(context, Executor { it.run() })
            .setRunAttemptCount(8).build()
        assertThat(worker.doWork()).isEqualTo(ListenableWorker.Result.retry())
        assertThat(policy.isAdminActive(admin)).isTrue()
        answer = 409
        assertThat(worker.doWork()).isEqualTo(ListenableWorker.Result.retry())
        assertThat(policy.isAdminActive(admin)).isTrue()
        assertThat(SyncStore(context, FakeSecretBox()).removed).isFalse()

        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 2)
        android.os.SystemClock.setCurrentTimeMillis(System.currentTimeMillis() + 7 * 86_400_000L)
        answer = 204
        assertThat(worker.doWork()).isEqualTo(ListenableWorker.Result.success())
        assertThat(policy.isAdminActive(admin)).isFalse()
        assertThat(seen.map { it.second }).containsExactlyElementsIn(
            List(3) { listOf("/api/device/setup-completion", "/api/device/undo-setup") }.flatten(),
        ).inOrder()
        assertThat(completionReports.map { it.getInt("undoMinutes") }).containsExactly(30, 30, 30)
        assertThat(completionReports.take(2).all { it.getLong("elapsedMs") >= 0 }).isTrue()
        assertThat(completionReports.last().has("elapsedMs")).isTrue()
        assertThat(completionReports.last().isNull("elapsedMs")).isTrue()
        assertThat(LightSetup.pendingCompletion(context, "test-phone")).isNull()
    }

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `undo keeps admin until the server confirms the pairing is gone`() {
        val context = completeSetup()
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("test-phone", "test-token")
        assertThat(store.markSetupUndoPending("test-phone")).isTrue()
        store.markReleased()
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        val admin = LightAdminReceiver.component(context)
        shadowOf(policy).setActiveAdmin(admin)

        val worker = TestWorkerBuilder<SyncWorker>(context, Executor { it.run() }).build()
        answer = 404
        responseBody = "404 Not Found"
        assertThat(worker.doWork()).isEqualTo(ListenableWorker.Result.retry())
        assertThat(policy.isAdminActive(admin)).isTrue()
        assertThat(store.removed).isFalse()

        answer = 401
        responseBody = """{"error":"unknown device; pair again"}"""
        assertThat(worker.doWork()).isEqualTo(ListenableWorker.Result.success())
        assertThat(policy.isAdminActive(admin)).isFalse()
        assertThat(store.removed).isTrue()
    }

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `startup recovers an accepted tap while offline`() {
        val context = completeSetup()
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("test-phone", "test-token")
        assertThat(store.markSetupUndoPending("test-phone")).isTrue()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)

        val vpn = Intent(context, PlainphoneVpnService::class.java)
        context.startService(vpn)
        SyncScheduler.ensurePeriodic(context)

        val manager = WorkManager.getInstance(context)
        fun localWork() = manager.getWorkInfosForUniqueWork("plainphone-local-setup-undo").get(5, TimeUnit.SECONDS)
        compose.waitUntil(5_000) { localWork().singleOrNull()?.state == WorkInfo.State.SUCCEEDED }
        assertThat(localWork().single().constraints.requiredNetworkType).isEqualTo(NetworkType.NOT_REQUIRED)
        assertThat(store.released).isTrue()
        assertThat(shadowOf(context as Application).nextStoppedService?.component).isEqualTo(vpn.component)
        assertThat(seen).isEmpty()
    }

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `reboot closes the window even if elapsed time would still allow undo`() {
        val context = completeSetup()
        assertThat(LightSetup.localUndoDeadline(context)).isGreaterThan(0L)
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 2)
        assertThat(LightSetup.localUndoDeadline(context)).isEqualTo(0L)
    }

    private fun completeSetup(): Context {
        val context = ApplicationProvider.getApplicationContext<Context>()
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 1)
        val config = ConfigStore(context)
        config.save(config.load().copy(serverUrl = "http://127.0.0.1:${server.address.port}"))
        LightSetup.saveProfile(context, "self")
        LightSetup.saveUndoMinutes(context, 30)
        LightSetup.markComplete(context)
        return context
    }

    @Implements(android.accessibilityservice.AccessibilityService::class)
    class GuardShadow {
        var disabled = false

        @Implementation fun disableSelf() {
            disabled = true
        }
    }

    @Implements(SyncStore::class)
    class PairedStore {
        @Implementation fun isPaired(): Boolean = true
        @Implementation fun getPhoneId(): String = "test-phone"
        @Implementation fun deviceToken(): String = "test-token"
    }

    @Test
    fun `setup undo reports with the paired token and accepts a lost acknowledgement`() {
        answer = 503
        assertThrows(HttpError::class.java) { api().reportSetupUndo("test-token") }
        answer = 204
        assertThat(api().reportSetupUndo("test-token")).isTrue()
        answer = 401
        responseBody = """{"error":"device token required"}"""
        assertThrows(HttpError::class.java) { api().reportSetupUndo("test-token") }
        responseBody = """{"error":"unknown device; pair again"}"""
        assertThat(api().reportSetupUndo("test-token")).isTrue()
        answer = 404
        responseBody = "404 Not Found"
        assertThrows(HttpError::class.java) { api().reportSetupUndo("test-token") }
        answer = 409
        assertThat(api().reportSetupUndo("test-token")).isFalse()
        assertThat(seen).containsExactlyElementsIn(
            List(6) { Triple("POST", "/api/device/undo-setup", "Bearer test-token") },
        )
    }

    @Test
    fun `posts to the released endpoint with the device token`() {
        assertThat(api().ackReleased("pp_d_abc")).isTrue()
        assertThat(seen.single()).isEqualTo(Triple("POST", "/api/device/released", "Bearer pp_d_abc"))
    }

    @Test
    fun `204 and 401 both mean the phone is gone from the server`() {
        answer = 204
        assertThat(api().ackReleased("t")).isTrue()
        answer = 401
        assertThat(api().ackReleased("t")).isTrue()
    }

    @Test
    fun `409 means nobody asked for a release`() {
        answer = 409
        assertThat(api().ackReleased("t")).isFalse()
    }

    @Test
    fun `any other answer is an error to try again later`() {
        answer = 500
        assertThrows(HttpError::class.java) { api().ackReleased("t") }
        answer = 429
        assertThrows(HttpError::class.java) { api().ackReleased("t") }
    }
}
