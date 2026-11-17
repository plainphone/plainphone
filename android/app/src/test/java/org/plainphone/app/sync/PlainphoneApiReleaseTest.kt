// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** `POST /device/released` against a local server: how the phone reads each answer. */
@RunWith(RobolectricTestRunner::class) // org.json is Android's
class PlainphoneApiReleaseTest {
    private lateinit var server: HttpServer
    private var answer = 204
    private val seen = mutableListOf<Triple<String, String, String?>>()

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            seen += Triple(ex.requestMethod, ex.requestURI.path, ex.requestHeaders.getFirst("Authorization"))
            ex.requestBody.readBytes()
            val body = if (answer == 204) ByteArray(0) else """{"error":"x"}""".toByteArray()
            ex.sendResponseHeaders(answer, if (answer == 204) -1 else body.size.toLong())
            if (answer != 204) ex.responseBody.use { it.write(body) }
            ex.close()
        }
        server.start()
    }

    @After
    fun stop() = server.stop(0)

    private fun api() = PlainphoneApi("http://127.0.0.1:${server.address.port}")

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
