// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import com.google.common.truth.Truth.assertThat
import android.app.Application
import android.content.Context
import android.content.res.Configuration
import androidx.test.core.app.ApplicationProvider
import java.io.IOException
import java.net.SocketTimeoutException
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.QuickSendAnswer

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class QuickMessageFallbackTest {
    private fun phone(tag: String): Context {
        val app = ApplicationProvider.getApplicationContext<Application>()
        val configuration = Configuration(app.resources.configuration).apply { setLocale(java.util.Locale.forLanguageTag(tag)) }
        return app.createConfigurationContext(configuration)
    }

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
    fun `a proxy's timeout or rate limit sends an SMS too, not give up`() {
        assertThat(quickMessageFallback(null, HttpError(408, ""))).isEqualTo(QuickFallback.SMS)
        assertThat(quickMessageFallback(null, HttpError(429, ""))).isEqualTo(QuickFallback.SMS)
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
        assertThat(sosSmsText(phone("da"), "Kim", "urgent", "code", "Blue bike", null)).isEqualTo("Blue bike")
        assertThat(sosSmsText(phone("da"), "Kim", "urgent", "code", "Blue bike", 55.5 to 12.25))
            .isEqualTo("Blue bike https://maps.google.com/?q=55.5,12.25")
    }

    private val link = "https://maps.google.com/?q=55.5,12.25"
    private val sms = mapOf(
        "da" to listOf(
            "SOS fra Kim: akut (skjult SOS). Position: ukendt. Sendt via Plainphone.",
            "SOS fra Kim: akut. Position: $link. Sendt via Plainphone.",
            "SOS fra Kim: har brug for hjælp. Position: ukendt. Sendt via Plainphone.",
        ),
        "en" to listOf(
            "SOS from Kim: urgent (hidden SOS). Location: unknown. Sent via Plainphone.",
            "SOS from Kim: urgent. Location: $link. Sent via Plainphone.",
            "SOS from Kim: needs help. Location: unknown. Sent via Plainphone.",
        ),
        "sv" to listOf(
            "SOS från Kim: akut (dold SOS). Position: okänd. Skickat via Plainphone.",
            "SOS från Kim: akut. Position: $link. Skickat via Plainphone.",
            "SOS från Kim: behöver hjälp. Position: okänd. Skickat via Plainphone.",
        ),
        "nb" to listOf(
            "SOS fra Kim: akutt (skjult SOS). Posisjon: ukjent. Sendt via Plainphone.",
            "SOS fra Kim: akutt. Posisjon: $link. Sendt via Plainphone.",
            "SOS fra Kim: trenger hjelp. Posisjon: ukjent. Sendt via Plainphone.",
        ),
        "de" to listOf(
            "SOS von Kim: dringend (verdeckter SOS). Standort: unbekannt. Gesendet über Plainphone.",
            "SOS von Kim: dringend. Standort: $link. Gesendet über Plainphone.",
            "SOS von Kim: braucht Hilfe. Standort: unbekannt. Gesendet über Plainphone.",
        ),
    )

    @Test
    fun `the SOS SMS is written in the phone's language, all five`() {
        for ((tag, expected) in sms) {
            val context = phone(tag)
            assertThat(sosSmsText(context, "Kim", "urgent", "power", null, null)).isEqualTo(expected[0])
            assertThat(sosSmsText(context, "Kim", "urgent", null, null, 55.5 to 12.25)).isEqualTo(expected[1])
            assertThat(sosSmsText(context, "Kim", "help", null, null, null)).isEqualTo(expected[2])
        }
    }

    @Test
    fun `a Swedish phone does not get a Danish SMS`() {
        assertThat(sosSmsText(phone("sv"), "Kim", "urgent", null, null, null)).doesNotContain("SOS fra")
    }

    @Test
    fun `a code word is the same text in every language`() {
        for (tag in sms.keys) {
            assertThat(sosSmsText(phone(tag), "Kim", "urgent", "code", "Blue bike", 55.5 to 12.25)).isEqualTo("Blue bike $link")
        }
    }

    @Test
    fun `every language says hidden SOS and fits one SMS segment where it can`() {
        for ((tag, expected) in sms) {
            val hidden = sosSmsText(phone(tag), "Kim", "urgent", "clock", null, null)
            assertThat(hidden).isEqualTo(expected[0])
            assertThat(hidden).containsMatch("\\((hidden|skjult|dold|verdeckter) SOS\\)")
            assertThat(hidden.length).isAtMost(160)
        }
    }
}

/** The phone builds SMS text only from string resources: a hard-coded sentence would be one language for everyone. */
class SmsTextNotHardCodedTest {
    private val sources = listOf("sos/SosDelivery.kt", "sos/QuickMessageDelivery.kt").map {
        java.io.File("src/main/java/org/plainphone/app/$it").readText()
    }

    @Test
    fun `sosSmsText has no sentence of its own`() {
        val body = sources[0].substringAfter("internal fun sosSmsText").substringBefore("internal fun submitSosFallback")
        val literals = Regex("\"([^\"]*)\"").findAll(body).map { it.groupValues[1] }.filter { it.isNotBlank() }.toList()
        assertThat(literals).containsExactly("https://maps.google.com/?q=\$lat,\$lon", "code", "urgent")
    }

    @Test
    fun `no Danish or English SOS sentence is left in the delivery code`() {
        for (source in sources) {
            assertThat(source).doesNotContain("Sendt via")
            assertThat(source).doesNotContain("SOS fra")
            assertThat(source).doesNotContain("Sent via")
        }
    }
}
