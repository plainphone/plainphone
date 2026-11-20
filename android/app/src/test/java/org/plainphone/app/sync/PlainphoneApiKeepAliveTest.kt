// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import android.app.Application
import android.net.ConnectivityManager
import android.net.Network
import java.io.BufferedReader
import java.io.ByteArrayInputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.RealObject
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class) // reportSafety uses Android’s org.json.
@Config(sdk = [35], application = Application::class, shadows = [PlainphoneApiKeepAliveTest.FreshNetworkShadow::class])
class PlainphoneApiKeepAliveTest {
    @Test
    fun `two rules responses reuse one connection`() {
        ServerSocket(0, 2, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = 3_000
            val executor = Executors.newSingleThreadExecutor()
            try {
                val accepts = executor.submit<Int> {
                    var requests = 0
                    var connections = 0
                    while (requests < 2) {
                        server.accept().use { socket ->
                            connections++
                            socket.soTimeout = 1_000
                            val input = socket.getInputStream().bufferedReader()
                            while (requests < 2) {
                                val request = try { input.readLine() } catch (_: SocketTimeoutException) { null }
                                if (request == null) break
                                while (!input.readLine().isNullOrEmpty()) {
                                    // Read through the blank line ending the request headers.
                                }
                                val response = if (requests++ == 0) {
                                    "HTTP/1.1 200 OK\r\nETag: e1\r\nContent-Length: 2\r\n\r\n{}"
                                } else {
                                    "HTTP/1.1 304 Not Modified\r\nContent-Length: 0\r\n\r\n"
                                }
                                socket.getOutputStream().apply {
                                    write(response.toByteArray(Charsets.US_ASCII))
                                    flush()
                                }
                            }
                        }
                    }
                    connections
                }
                val api = PlainphoneApi("http://127.0.0.1:${server.localPort}") {
                    it.openConnection(Proxy.NO_PROXY) as HttpURLConnection
                }
                assertThat(api.fetchRules("test", null)).isEqualTo(RulesResult.Changed("e1", "{}"))
                assertThat(api.fetchRules("test", "e1")).isEqualTo(RulesResult.Unchanged)
                assertThat(accepts.get(5, TimeUnit.SECONDS)).isEqualTo(1)
            } finally {
                executor.shutdownNow()
            }
        }
    }

    @Test
    fun `a rules read interrupted on a pooled connection retries with connection close`() {
        checkRetryOnFreshConnection(
            failedRequest = "GET /api/device/rules",
            // EOF before headers lets the JDK silently retry GET itself. Interrupt the body
            // to exercise our retry after the transport has returned the response.
            partialResponse = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{",
        ) { api -> assertThat(api.fetchRules("test", "e1")).isEqualTo(RulesResult.Unchanged) }
    }

    @Test
    fun `a safety report retries after the pooled socket closes without a response`() {
        checkRetryOnFreshConnection(
            failedRequest = "POST /api/device/safety/00000000-0000-0000-0000-000000000001",
            partialResponse = "",
        ) { api -> assertThat(api.reportSafety("test", "00000000-0000-0000-0000-000000000001", "ok")).isTrue() }
    }

    @Test
    fun `a rules read timeout is not retried`() {
        assertSingleAttempt(SocketTimeoutException("read timed out")) { it.fetchRules("test", null) }
    }

    @Test
    fun `enrollment and pairing creation are not replayed after losing a response`() {
        assertSingleAttempt(IOException("connection reset")) { it.enroll("token", "install", emptyMap()) }
        assertSingleAttempt(IOException("connection reset")) { it.startPairing("strong", emptyMap()) }
    }

    @Test
    fun `failure opening a rules connection is not retried`() {
        var opens = 0
        val api = PlainphoneApi("http://unused.test") {
            opens++
            throw IOException("cannot open")
        }

        assertThrows(IOException::class.java) { api.fetchRules("test", null) }
        assertThat(opens).isEqualTo(1)
    }

    private fun assertSingleAttempt(failure: IOException, call: (PlainphoneApi) -> Unit) {
        var opens = 0
        val api = PlainphoneApi("http://unused.test") { url ->
            opens++
            object : HttpURLConnection(url) {
                override fun connect() = Unit
                override fun usingProxy() = false
                override fun disconnect() = Unit
                override fun getOutputStream() = java.io.ByteArrayOutputStream()
                override fun getResponseCode(): Int = throw failure
            }
        }
        assertThat(assertThrows(IOException::class.java) { call(api) }).isSameInstanceAs(failure)
        assertThat(opens).isEqualTo(1)
    }

    @Test
    fun `on demand location uploads replay the same fix after losing a response`() {
        for (purpose in listOf("find:123", "checkin:00000000-0000-0000-0000-000000000001")) {
            checkRetryOnFreshConnection("PUT /api/device/location", "") { api ->
                assertThat(api.reportLocation("test", LocationFix(55.0, 12.0, 10f, 456), purpose)).isTrue()
            }
        }
    }

    @Test
    fun `a location upload that is replayed and answered 409 counts as stored`() {
        for (purpose in listOf("find:123", "checkin:00000000-0000-0000-0000-000000000001")) {
            checkRetryOnFreshConnection("PUT /api/device/location", "", retryStatus = "409 Conflict") { api ->
                // The first attempt reached the server and stored the fix; only the answer was lost.
                assertThat(api.reportLocation("test", LocationFix(55.0, 12.0, 10f, 456), purpose)).isTrue()
            }
        }
    }

    @Test
    fun `a plain 409 on a location upload is still a refusal`() {
        val api = PlainphoneApi("http://unused.test") { url ->
            object : HttpURLConnection(url) {
                override fun connect() = Unit
                override fun usingProxy() = false
                override fun disconnect() = Unit
                override fun getOutputStream() = java.io.ByteArrayOutputStream()
                override fun getResponseCode() = 409
                override fun getErrorStream() = ByteArrayInputStream("{}".toByteArray())
            }
        }
        assertThat(api.reportLocation("test", LocationFix(55.0, 12.0, 10f, 456), "find:123")).isFalse()
    }

    @Test
    fun `enrollment and pairing creation use a fresh connection that closes`() {
        checkNotReplayed(fresh = true) { it.enroll("token", "install", emptyMap()) }
        checkNotReplayed(fresh = true) { it.startPairing("strong", emptyMap()) }
    }

    @Test
    fun `a pairing poll uses a fresh connection and is not retried`() {
        // An EOF before any header would let the JDK retry a GET by itself, so cut the body instead.
        val cutBody = "HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n2\r\n{"
        checkNotReplayed(fresh = true, partialResponse = cutBody) { it.pollPairing("00000000-0000-0000-0000-000000000001", "secret") }
    }

    @Test
    fun `a scheduled always location upload is never retried`() {
        checkNotReplayed(fresh = false) { it.reportLocation("test", LocationFix(55.0, 12.0, 10f, 456), "always") }
    }

    /**
     * Serves one rules read on a pooled connection, then drops the call under test without an answer.
     * The call must fail and must not be sent again, on a fresh connection or by the JDK itself.
     */
    private fun checkNotReplayed(fresh: Boolean, partialResponse: String = "", call: (PlainphoneApi) -> Unit) {
        ServerSocket(0, 2, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = 3_000
            val executor = Executors.newSingleThreadExecutor()
            try {
                val observed = executor.submit<Request> {
                    server.accept().use { pooled ->
                        pooled.soTimeout = 3_000
                        val input = pooled.getInputStream().bufferedReader()
                        assertThat(readRequest(input).line).startsWith("GET /api/device/rules ")
                        // Robolectric's fresh network shares the JDK's connection cache, so a kept-alive socket would
                        // be picked up again. Closing this one makes a fresh connection observable as a new accept.
                        val keepAlive = if (fresh) "Connection: close\r\n" else ""
                        pooled.getOutputStream().write("HTTP/1.1 200 OK\r\nETag: e1\r\n${keepAlive}Content-Length: 2\r\n\r\n{}".toByteArray())
                        val request = if (fresh) {
                            server.accept().use { socket ->
                                socket.soTimeout = 3_000
                                readRequest(socket.getInputStream().bufferedReader()).also {
                                    socket.getOutputStream().write(partialResponse.toByteArray())
                                }
                            }
                        } else readRequest(input)
                        server.soTimeout = 1_500
                        assertThrows(SocketTimeoutException::class.java) { server.accept().close() }
                        request
                    }
                }
                val app = RuntimeEnvironment.getApplication()
                val manager = app.getSystemService(ConnectivityManager::class.java)
                check(manager.bindProcessToNetwork(ShadowNetwork.newInstance(100)))
                try {
                    val api = PlainphoneApi("http://127.0.0.1:${server.localPort}", app)
                    freshOpens = 0
                    assertThat(api.fetchRules("test", null)).isEqualTo(RulesResult.Changed("e1", "{}"))
                    assertThrows(IOException::class.java) { call(api) }
                    assertThat(freshOpens).isEqualTo(if (fresh) 1 else 0)
                    val request = observed.get(10, TimeUnit.SECONDS)
                    if (fresh) assertThat(request.headers["connection"]).isEqualTo("close")
                } finally {
                    manager.bindProcessToNetwork(null)
                }
            } finally {
                executor.shutdownNow()
            }
        }
    }

    companion object {
        private var freshOpens = 0
    }

    @Implements(Network::class)
    class FreshNetworkShadow {
        @RealObject
        private lateinit var network: Network

        @Implementation
        fun openConnection(url: java.net.URL): HttpURLConnection {
            val manager = RuntimeEnvironment.getApplication().getSystemService(ConnectivityManager::class.java)
            val bound = checkNotNull(manager.boundNetworkForProcess)
            assertThat(network).isNotSameInstanceAs(bound)
            assertThat(network.networkHandle).isEqualTo(bound.networkHandle)
            freshOpens++
            return url.openConnection(Proxy.NO_PROXY) as HttpURLConnection
        }
    }

    private fun checkRetryOnFreshConnection(
        failedRequest: String,
        partialResponse: String,
        retryStatus: String? = null,
        call: (PlainphoneApi) -> Unit,
    ) {
        ServerSocket(0, 2, InetAddress.getByName("127.0.0.1")).use { server ->
            server.soTimeout = 3_000
            val executor = Executors.newSingleThreadExecutor()
            try {
                val observed = executor.submit<Unit> {
                    val failed = server.accept().use { socket ->
                        socket.soTimeout = 3_000
                        val input = socket.getInputStream().bufferedReader()
                        val output = socket.getOutputStream()
                        assertThat(readRequest(input).line).startsWith("GET /api/device/rules ")
                        output.write("HTTP/1.1 200 OK\r\nETag: e1\r\nContent-Length: 2\r\n\r\n{}".toByteArray())
                        readRequest(input).also {
                            assertThat(it.line).startsWith("$failedRequest ")
                            assertThat(it.headers["connection"]).isNotEqualTo("close")
                            output.write(partialResponse.toByteArray())
                        }
                    }
                    server.accept().use { socket ->
                        socket.soTimeout = 3_000
                        val retry = readRequest(socket.getInputStream().bufferedReader())
                        assertThat(retry).isEqualTo(failed.copy(headers = failed.headers + ("connection" to "close")))
                        val status = retryStatus ?: if (failedRequest.startsWith("GET")) "304 Not Modified" else "204 No Content"
                        socket.getOutputStream().write("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                    }
                }
                val app = RuntimeEnvironment.getApplication()
                val manager = app.getSystemService(ConnectivityManager::class.java)
                check(manager.bindProcessToNetwork(ShadowNetwork.newInstance(100)))
                try {
                    val api = PlainphoneApi("http://127.0.0.1:${server.localPort}", app)
                    freshOpens = 0
                    assertThat(api.fetchRules("test", null)).isEqualTo(RulesResult.Changed("e1", "{}"))
                    assertThat(freshOpens).isEqualTo(0)
                    call(api)
                    assertThat(freshOpens).isEqualTo(1)
                    observed.get(5, TimeUnit.SECONDS)
                } finally {
                    manager.bindProcessToNetwork(null)
                }
            } finally {
                executor.shutdownNow()
            }
        }
    }

    private data class Request(val line: String, val headers: Map<String, String>, val body: String)

    private fun readRequest(input: BufferedReader): Request {
        val line = checkNotNull(input.readLine())
        val headers = generateSequence(input::readLine).takeWhile(String::isNotEmpty)
            .associate { it.substringBefore(':').lowercase() to it.substringAfter(':').trim() }
        val body = buildString {
            repeat(headers["content-length"]?.toInt() ?: 0) {
                val character = input.read()
                check(character >= 0)
                append(character.toChar())
            }
        }
        return Request(line, headers, body)
    }

    @Test
    fun `a fully read response closes its stream without disconnecting`() {
        var closed = false
        var disconnected = false
        val api = PlainphoneApi("http://unused.test") { url ->
            object : HttpURLConnection(url) {
                override fun connect() = Unit
                override fun usingProxy() = false
                override fun disconnect() { disconnected = true }
                override fun getResponseCode() = 200
                override fun getHeaderField(name: String?) = "e1"
                override fun getInputStream() = object : ByteArrayInputStream("{}".toByteArray()) {
                    override fun close() { closed = true }
                }
            }
        }
        assertThat(api.fetchRules("test", null)).isEqualTo(RulesResult.Changed("e1", "{}"))
        assertThat(closed).isTrue()
        assertThat(disconnected).isFalse()
    }
}
