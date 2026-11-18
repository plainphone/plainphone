// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayInputStream
import java.net.HttpURLConnection
import java.net.InetAddress
import java.net.Proxy
import java.net.ServerSocket
import java.net.SocketTimeoutException
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Test

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
