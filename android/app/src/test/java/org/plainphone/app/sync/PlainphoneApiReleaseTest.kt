// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.HttpURLConnection
import java.net.InetSocketAddress
import java.net.Proxy
import java.net.URL
import java.time.Duration
import org.plainphone.app.ConfigStore
import org.plainphone.app.light.LightSetup
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowSystemClock

/** `POST /device/released` against a local server: how the phone reads each answer. */
@RunWith(RobolectricTestRunner::class) // org.json is Android's
class PlainphoneApiReleaseTest {
    private lateinit var server: HttpServer
    private var connectivity: ConnectivityManager? = null
    private var answer = 204
    private val seen = mutableListOf<Triple<String, String, String?>>()

    private lateinit var requestBody: org.json.JSONObject

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            seen += Triple(ex.requestMethod, ex.requestURI.path, ex.requestHeaders.getFirst("Authorization"))
            val request = ex.requestBody.bufferedReader().readText()
            requestBody = org.json.JSONObject(request.ifEmpty { "{}" })

            val body = if (answer == 204) ByteArray(0) else """{"undoRemainingMs":480000}""".toByteArray()
            ex.sendResponseHeaders(answer, if (answer == 204) -1 else body.size.toLong())
            if (answer != 204) ex.responseBody.use { it.write(body) }
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
    fun `retries unregistered completion with the original wall time on the next boot`() {
        val beforeCompletion = System.currentTimeMillis()
        val context = completeSetup()
        val afterCompletion = System.currentTimeMillis()
        answer = 503
        assertThrows(HttpError::class.java) { LightSetup.undoDeadline(context) }
        assertThat(requestBody.getLong("elapsedMs")).isEqualTo(0L)

        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 2)
        ShadowSystemClock.advanceBy(Duration.ofMinutes(2))
        seen.clear()
        answer = 200
        assertThat(LightSetup.undoDeadline(context)).isGreaterThan(0L)
        assertThat(seen.single().first).isEqualTo("POST")
        val sentCompletion = requestBody.getLong("completedAtMs")
        assertThat(sentCompletion in beforeCompletion..afterCompletion).isTrue()

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
