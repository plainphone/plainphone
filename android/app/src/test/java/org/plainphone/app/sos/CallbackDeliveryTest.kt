// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.net.SocketTimeoutException
import org.junit.Test
import org.plainphone.app.sync.CallbackAnswer
import org.plainphone.app.sync.HttpError

/** "Ask a parent to call" on the phone (docs/sos.md#asking-a-parent-to-call): what it remembers and when it gives up. */
class CallbackDeliveryTest {
    private val hour = 3_600_000L
    private val at = 1_000_000_000L

    @Test
    fun `a server answer is taken as it is`() {
        for (state in listOf("queued", "sent", "expired", "done")) {
            assertThat(callbackNext(CallbackAnswer("a", state), null, at, at)).isEqualTo(CallbackNext.DONE)
        }
    }

    @Test
    fun `no network or a server error is retried while the request is still open`() {
        assertThat(callbackNext(null, IOException("no network"), at, at + hour)).isEqualTo(CallbackNext.RETRY)
        assertThat(callbackNext(null, SocketTimeoutException(), at, at + hour)).isEqualTo(CallbackNext.RETRY)
        assertThat(callbackNext(null, HttpError(503, ""), at, at + hour)).isEqualTo(CallbackNext.RETRY)
        // A server without the endpoint yet.
        assertThat(callbackNext(null, HttpError(404, ""), at, at + hour)).isEqualTo(CallbackNext.RETRY)
    }

    @Test
    fun `offline for a day, the request is given up as expired`() {
        assertThat(callbackNext(null, IOException(), at, at + 24 * hour - 1)).isEqualTo(CallbackNext.RETRY)
        assertThat(callbackNext(null, IOException(), at, at + 24 * hour)).isEqualTo(CallbackNext.GIVE_UP)
    }

    @Test
    fun `switched off since, or any other client error, is not delivered and not retried`() {
        assertThat(callbackNext(null, HttpError(403, ""), at, at + hour)).isEqualTo(CallbackNext.GIVE_UP)
        assertThat(callbackNext(null, HttpError(400, ""), at, at + hour)).isEqualTo(CallbackNext.GIVE_UP)
    }

    @Test
    fun `nothing asked shows nothing, and every state is told apart`() {
        val now = at + hour
        assertThat(callbackStatus(null, now)).isNull()
        assertThat(callbackStatus(CallbackLocal("a", at, "waiting"), now)).isEqualTo(CallbackStatus.WAITING)
        assertThat(callbackStatus(CallbackLocal("a", at, "queued"), now)).isEqualTo(CallbackStatus.QUEUED)
        assertThat(callbackStatus(CallbackLocal("a", at, "sent"), now)).isEqualTo(CallbackStatus.SENT)
        assertThat(callbackStatus(CallbackLocal("a", at, "done"), now)).isEqualTo(CallbackStatus.DONE)
        assertThat(callbackStatus(CallbackLocal("a", at, "expired"), now)).isEqualTo(CallbackStatus.EXPIRED)
        assertThat(callbackStatus(CallbackLocal("a", at, "failed"), now)).isEqualTo(CallbackStatus.FAILED)
    }

    @Test
    fun `an open request expires by the phone's own clock after 24 hours, an answered one stays answered`() {
        val late = at + 24 * hour
        for (state in listOf("waiting", "queued", "sent")) {
            assertThat(callbackStatus(CallbackLocal("a", at, state), late - 1)).isNotEqualTo(CallbackStatus.EXPIRED)
            assertThat(callbackStatus(CallbackLocal("a", at, state), late)).isEqualTo(CallbackStatus.EXPIRED)
        }
        assertThat(callbackStatus(CallbackLocal("a", at, "done"), late)).isEqualTo(CallbackStatus.DONE)
    }

    @Test
    fun `a second tap while a request is open would only repeat it`() {
        assertThat(callbackOpen(CallbackStatus.WAITING)).isTrue()
        assertThat(callbackOpen(CallbackStatus.QUEUED)).isTrue()
        assertThat(callbackOpen(CallbackStatus.SENT)).isTrue()
        assertThat(callbackOpen(null)).isFalse()
        assertThat(callbackOpen(CallbackStatus.DONE)).isFalse()
        assertThat(callbackOpen(CallbackStatus.EXPIRED)).isFalse()
        assertThat(callbackOpen(CallbackStatus.FAILED)).isFalse()
    }
}
