// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.net.SocketTimeoutException
import org.junit.Test
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.QuickSendAnswer

class QuickMessageFallbackTest {
    @Test
    fun `a push to at least one parent device is enough`() {
        assertThat(quickMessageFallback(QuickSendAnswer(1), null)).isEqualTo(QuickFallback.DONE)
        assertThat(quickMessageFallback(QuickSendAnswer(3), null)).isEqualTo(QuickFallback.DONE)
    }

    @Test
    fun `no parent device reached, no network or a server error sends an SMS`() {
        assertThat(quickMessageFallback(QuickSendAnswer(0), null)).isEqualTo(QuickFallback.SMS)
        assertThat(quickMessageFallback(null, IOException("no network"))).isEqualTo(QuickFallback.SMS)
        assertThat(quickMessageFallback(null, SocketTimeoutException())).isEqualTo(QuickFallback.SMS)
        assertThat(quickMessageFallback(null, HttpError(503, ""))).isEqualTo(QuickFallback.SMS)
        assertThat(quickMessageFallback(null, HttpError(500, ""))).isEqualTo(QuickFallback.SMS)
        // A server without the endpoint.
        assertThat(quickMessageFallback(null, HttpError(404, ""))).isEqualTo(QuickFallback.SMS)
    }

    @Test
    fun `over the server's limit it stays quiet, and a send still in progress is asked again`() {
        assertThat(quickMessageFallback(QuickSendAnswer(0, limited = true), null)).isEqualTo(QuickFallback.DONE)
        assertThat(quickMessageFallback(QuickSendAnswer(0, pending = true), null)).isEqualTo(QuickFallback.RETRY)
    }

    @Test
    fun `a rejected message is not sent another way`() {
        assertThat(quickMessageFallback(null, HttpError(400, ""))).isEqualTo(QuickFallback.GIVE_UP)
        assertThat(quickMessageFallback(null, HttpError(401, ""))).isEqualTo(QuickFallback.GIVE_UP)
    }

    @Test
    fun `a code word's SMS is only its text and a map link, like any message`() {
        assertThat(sosSmsText("Kim", "urgent", "code", "Blue bike", null)).isEqualTo("Blue bike")
        assertThat(sosSmsText("Kim", "urgent", "code", "Blue bike", 55.5 to 12.25))
            .isEqualTo("Blue bike https://maps.google.com/?q=55.5,12.25")
    }

    @Test
    fun `a hidden SOS keeps the usual SOS text, the SOS screen's text is unchanged`() {
        assertThat(sosSmsText("Kim", "urgent", "power", null, null))
            .isEqualTo("SOS fra Kim: akut (skjult SOS). Position: ukendt. Sendt via Plainphone.")
        assertThat(sosSmsText("Kim", "urgent", null, null, 55.5 to 12.25))
            .isEqualTo("SOS fra Kim: akut. Position: https://maps.google.com/?q=55.5,12.25. Sendt via Plainphone.")
        assertThat(sosSmsText("Kim", "help", null, null, null))
            .isEqualTo("SOS fra Kim: har brug for hjælp. Position: ukendt. Sendt via Plainphone.")
    }
}
