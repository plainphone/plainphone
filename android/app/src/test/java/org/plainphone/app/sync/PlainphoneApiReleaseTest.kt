// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.URL
import java.time.Duration
import java.util.concurrent.TimeUnit
import org.plainphone.app.ConfigStore
import org.plainphone.app.R
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.UndoSetupAction
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowSystemClock

/** Release and setup undo against a local server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PlainphoneApiReleaseTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Volatile private var authorizationLost = false
    private lateinit var server: HttpServer
    private var connectivity: ConnectivityManager? = null
    @Volatile private var answer = 204
    private val seen = mutableListOf<Triple<String, String, String?>>()

    private lateinit var requestBody: org.json.JSONObject

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            seen += Triple(ex.requestMethod, ex.requestURI.path, ex.requestHeaders.getFirst("Authorization"))
            val request = ex.requestBody.bufferedReader().readText()
            requestBody = org.json.JSONObject(request.ifEmpty { "{}" })

            val payload = if (authorizationLost && ex.requestMethod == "GET") {
                """{"undoRemainingMs":0,"undoAuthorized":true}"""
            } else """{"undoRemainingMs":480000}"""
            val status = if (authorizationLost && ex.requestMethod == "GET") 200 else answer
            val body = payload.toByteArray()
            ex.sendResponseHeaders(status, if (status == 204) -1 else body.size.toLong())
            if (status != 204) ex.responseBody.use { it.write(body) }
            ex.close()
        }
        server.start()
    }

    @After
    fun stop() {
        connectivity?.bindProcessToNetwork(null)
        server.stop(0)
    }

    private fun api() = PlainphoneApi("http://127.0.0.1:${server.address.port}")

    @Test
    @Config(shadows = [PairedStore::class, LoopbackNetwork::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `retries unregistered completion with its age on the next boot`() {
        val context = completeSetup()
        answer = 503
        assertThrows(HttpError::class.java) { LightSetup.undoDeadline(context) }
        assertThat(requestBody.getLong("elapsedMs")).isEqualTo(0L)

        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 2)
        // Robolectric advances elapsedRealtime separately from the Java wall clock.
        val completedAt = System.currentTimeMillis() - 120_000L
        context.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE).edit()
            .putLong("completedAtMs", completedAt).commit()
        seen.clear()
        answer = 200
        assertThat(LightSetup.undoDeadline(context)).isGreaterThan(0L)
        assertThat(seen.single().first).isEqualTo("POST")
        assertThat(requestBody.getLong("elapsedMs") in 120_000L..(System.currentTimeMillis() - completedAt)).isTrue()

        seen.clear()
        LightSetup.undoDeadline(context)
        assertThat(seen.single().first).isEqualTo("GET")
    }

    @Test
    @Config(shadows = [PairedStore::class, LoopbackNetwork::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `authorizes directly and retries the original tap after a connection error`() {
        val context = completeSetup()
        answer = 200
        val deadline = LightSetup.undoDeadline(context)
        val store = SyncStore(context)
        ShadowSystemClock.advanceBy(Duration.ofMillis(479_000))
        val tap = checkNotNull(LightSetup.recordUndoTap(context, deadline))
        assertThat(store.setupUndoPending).isFalse()

        answer = 503
        seen.clear()
        assertThrows(HttpError::class.java) { LightSetup.requestUndo(context, tap) }
        assertThat(seen.single().second).isEqualTo("/api/device/undo-setup/authorize")
        assertThat(requestBody.getLong("tapAgeMs")).isEqualTo(0L)
        assertThat(store.setupUndoPending).isFalse()

        ShadowSystemClock.advanceBy(Duration.ofSeconds(2))
        answer = 204
        val retry = checkNotNull(LightSetup.recordUndoTap(context, deadline))
        assertThat(retry).isEqualTo(tap)
        assertThat(LightSetup.requestUndo(context, retry)).isTrue()
        assertThat(requestBody.getLong("tapAgeMs")).isEqualTo(2_000L)
        assertThat(requestBody.getLong("tapRemainingMs")).isEqualTo(1_000L)
        assertThat(store.setupUndoPending && store.setupUndoAuthorized).isTrue()
    }

    @Test
    @Config(shadows = [PairedStore::class, LoopbackNetwork::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `shows retry after a connection failure and schedules release only after 204`() {
        retryFromUndoButton(reboot = false)
    }

    @Test
    @Config(shadows = [PairedStore::class, LoopbackNetwork::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `shows retry after reboot and schedules release when the server already authorized it`() {
        retryFromUndoButton(reboot = true)
    }

    private fun retryFromUndoButton(reboot: Boolean) {
        val context = completeSetup()
        val store = SyncStore(context)
        SyncStore(context, FakeSecretBox()).savePaired("test-phone", "test-token")
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val manager = WorkManager.getInstance(context)
        fun releaseJobs() = manager.getWorkInfosForUniqueWork("plainphone-sync-finish-undo").get(5, TimeUnit.SECONDS)
        val activity = compose.activity
        val state = mutableIntStateOf(0)
        fun label(id: Int) = activity.getString(id)
        fun waitFor(id: Int) {
            compose.waitUntil(5_000) { compose.onAllNodesWithText(label(id)).fetchSemanticsNodes().isNotEmpty() }
        }

        answer = 200
        assertThat(LightSetup.undoDeadline(context)).isGreaterThan(0L)
        compose.setContent { UndoSetupAction(activity, state.intValue) }
        compose.onNodeWithText(label(R.string.setup_undo)).assertIsDisplayed()

        answer = 503
        compose.onNodeWithText(label(R.string.setup_undo)).performClick()
        waitFor(R.string.setup_undo_retry)
        compose.onNodeWithText(label(R.string.pairing_retry)).assertIsDisplayed()
        assertThat(store.setupUndoPending).isFalse()
        assertThat(releaseJobs()).isEmpty()

        if (reboot) {
            // Reopen the action after reboot. The server already accepted the original request.
            Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 2)
            ShadowSystemClock.advanceBy(Duration.ofMinutes(12))
            authorizationLost = true
            compose.runOnIdle { state.intValue++ }
        } else {
            answer = 204
        }
        compose.onNodeWithText(label(R.string.pairing_retry)).assertIsDisplayed().performClick()
        waitFor(R.string.setup_undo_requested)
        assertThat(store.setupUndoAuthorized).isTrue()
        compose.waitUntil(5_000) { releaseJobs().size == 1 }
    }

    private fun completeSetup(): Context {
        val context = ApplicationProvider.getApplicationContext<Context>()
        connectivity = context.getSystemService(ConnectivityManager::class.java).also {
            check(it.bindProcessToNetwork(ShadowNetwork.newInstance(100)))
        }
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 1)
        val config = ConfigStore(context)
        config.save(config.load().copy(serverUrl = "http://127.0.0.1:${server.address.port}"))
        LightSetup.saveProfile(context, "self")
        LightSetup.markComplete(context)
        return context
    }

    @Implements(Network::class)
    class LoopbackNetwork {
        @Implementation fun openConnection(url: URL): HttpURLConnection =
            url.openConnection(Proxy.NO_PROXY) as HttpURLConnection
    }

    @Implements(SyncStore::class)
    class PairedStore {
        @Implementation fun isPaired(): Boolean = true
        @Implementation fun getPhoneId(): String = "test-phone"
        @Implementation fun deviceToken(): String = "test-token"
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
