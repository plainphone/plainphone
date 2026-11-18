// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import android.app.Application
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
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class) // reportSafety uses Android’s org.json.
@Config(sdk = [35], application = Application::class)
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
    fun `a repeated transport failure stops after one rules retry and pairing creation is never replayed`() {
        var opens = 0
        val api = PlainphoneApi("http://unused.test") {
            opens++
            throw IOException("connection reset")
        }

        assertThrows(IOException::class.java) { api.fetchRules("test", null) }
        assertThat(opens).isEqualTo(2)
        opens = 0
        assertThrows(IOException::class.java) { api.startPairing("strong", emptyMap()) }
        assertThat(opens).isEqualTo(1)
    }

    private fun checkRetryOnFreshConnection(
        failedRequest: String,
        partialResponse: String,
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
                        val status = if (failedRequest.startsWith("POST")) "204 No Content" else "304 Not Modified"
                        socket.getOutputStream().write("HTTP/1.1 $status\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray())
                    }
                }
                val api = PlainphoneApi("http://127.0.0.1:${server.localPort}") {
                    it.openConnection(Proxy.NO_PROXY) as HttpURLConnection
                }
                assertThat(api.fetchRules("test", null)).isEqualTo(RulesResult.Changed("e1", "{}"))
                call(api)
                observed.get(5, TimeUnit.SECONDS)
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
