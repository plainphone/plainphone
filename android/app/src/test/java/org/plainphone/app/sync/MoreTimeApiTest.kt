// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.Application
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.io.IOException
import java.net.InetSocketAddress
import java.time.Instant
import java.time.LocalDate
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The rules switches and `/device/more-time-requests` against a local server. Robolectric for org.json. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class MoreTimeApiTest {
    private lateinit var server: HttpServer
    @Volatile private var status = 201
    @Volatile private var body = REQUEST
    private val seen = java.util.Collections.synchronizedList(mutableListOf<Triple<String, String, String>>())
    private val api get() = PlainphoneApi("http://127.0.0.1:${server.address.port}")

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            seen += Triple(ex.requestMethod, ex.requestURI.path, ex.requestBody.readBytes().decodeToString())
            val bytes = body.toByteArray()
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    @After
    fun stop() = server.stop(0)

    @Test
    fun `both switches default to on when an older server leaves them out`() {
        val r = ServerRules.parse(rulesJson())
        assertThat(r.askMoreTimeEnabled).isTrue()
        assertThat(r.limitWarningEnabled).isTrue()
    }

    @Test
    fun `the switches are read when present`() {
        val on = ServerRules.parse(JSONObject(rulesJson()).put("askMoreTimeEnabled", true).put("limitWarningEnabled", true).toString())
        assertThat(on.askMoreTimeEnabled).isTrue()
        assertThat(on.limitWarningEnabled).isTrue()
        val off = ServerRules.parse(JSONObject(rulesJson()).put("askMoreTimeEnabled", false).put("limitWarningEnabled", false).toString())
        assertThat(off.askMoreTimeEnabled).isFalse()
        assertThat(off.limitWarningEnabled).isFalse()
        val one = ServerRules.parse(JSONObject(rulesJson()).put("limitWarningEnabled", false).toString())
        assertThat(one.askMoreTimeEnabled).isTrue()
        assertThat(one.limitWarningEnabled).isFalse()
    }

    @Test
    fun `asking posts the target and a trimmed reason and reads the request`() {
        val r = api.askMoreTime("pp_d_token", "com.spotify.music", "  Finishing a playlist  ")
        assertThat(r).isEqualTo(
            MoreTimeRequest(
                id = "8b0c7c1e-0000-4000-8000-000000000001", packageName = "com.spotify.music", reason = "Finishing a playlist",
                day = LocalDate.of(2027, 1, 4), status = MoreTimeRequest.Status.PENDING, answer = null, grantedMinutes = null,
                createdAt = Instant.parse("2027-01-04T14:20:00Z"), decidedAt = null,
            ),
        )
        val (method, path, sent) = seen.single()
        assertThat(method).isEqualTo("POST")
        assertThat(path).isEqualTo("/api/device/more-time-requests")
        assertThat(JSONObject(sent).getString("packageName")).isEqualTo("com.spotify.music")
        assertThat(JSONObject(sent).getString("reason")).isEqualTo("Finishing a playlist")
    }

    @Test
    fun `an empty reason is left out and a long one is cut to the server's limit`() {
        api.askMoreTime("t", "*", "   ")
        assertThat(JSONObject(seen.last().third).has("reason")).isFalse()
        api.askMoreTime("t", "*", "x".repeat(400))
        assertThat(JSONObject(seen.last().third).getString("reason")).hasLength(MORE_TIME_REASON_MAX)
    }

    @Test
    fun `the already open request (200) is a success too`() {
        status = 200
        assertThat(api.askMoreTime("t", "com.spotify.music", null).id).isEqualTo("8b0c7c1e-0000-4000-8000-000000000001")
    }

    @Test
    fun `switched off, not possible and too many are told apart`() {
        for (code in listOf(400, 403, 409, 429)) {
            status = code
            body = """{"error":"x"}"""
            val e = assertThrows(HttpError::class.java) { api.askMoreTime("t", "*", null) }
            assertThat(e.status).isEqualTo(code)
        }
    }

    @Test
    fun `the list is parsed with answers, and garbage is an IOException`() {
        status = 200
        body = """{"requests":[${REQUEST.replace("\"pending\"", "\"approved\"").replace("\"answer\":null", "\"answer\":\"day\"")
            .replace("\"grantedMinutes\":null", "\"grantedMinutes\":214").replace("\"decidedAt\":null", "\"decidedAt\":\"2027-01-04T20:26:00.000Z\"")}]}"""
        val list = api.moreTimeRequests("t")
        assertThat(seen.last().first).isEqualTo("GET")
        assertThat(list.single().status).isEqualTo(MoreTimeRequest.Status.APPROVED)
        assertThat(list.single().answer).isEqualTo("day")
        assertThat(list.single().grantedMinutes).isEqualTo(214)
        assertThat(list.single().decidedAt).isEqualTo(Instant.parse("2027-01-04T20:26:00Z"))

        body = """{"requests":[{"id":"x"}]}"""
        assertThrows(IOException::class.java) { api.moreTimeRequests("t") }
        body = """{"requests":[${REQUEST.replace("\"pending\"", "\"maybe\"")}]}"""
        assertThrows(IOException::class.java) { api.moreTimeRequests("t") }
    }

    @Test
    fun `a missing route on an old server is an HttpError, not a crash`() {
        status = 404
        body = """{"error":"not found"}"""
        assertThat(assertThrows(HttpError::class.java) { api.moreTimeRequests("t") }.status).isEqualTo(404)
    }

    private companion object {
        const val REQUEST = """{"id":"8b0c7c1e-0000-4000-8000-000000000001","packageName":"com.spotify.music","reason":"Finishing a playlist",
            "day":"2027-01-04","status":"pending","answer":null,"grantedMinutes":null,"createdAt":"2027-01-04T14:20:00.000Z","decidedAt":null}"""
    }
}
