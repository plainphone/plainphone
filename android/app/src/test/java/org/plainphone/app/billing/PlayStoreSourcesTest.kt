// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.billing

import com.google.common.truth.Truth.assertThat
import com.google.common.truth.Truth.assertWithMessage
import java.io.File
import org.junit.Test

/**
 * Play builds sell only through Google Play: no card (Stripe) path and no web checkout may reach
 * src/play. The phone also never finishes a purchase itself; the server does after checking it.
 * Runs on the default (direct) build, so it reads the sources as text.
 */
class PlayStoreSourcesTest {
    private val play = File("src/play")

    private fun sources(dir: File) = dir.walkTopDown().filter { it.isFile }.toList()

    @Test
    fun `the Play source set exists and has the store code`() {
        assertThat(sources(play).map { it.name }).contains("Stores.kt")
        assertThat(sources(File("src/direct")).map { it.name }).contains("Stores.kt")
    }

    @Test
    fun `no Stripe and no checkout URL in the Play build`() {
        val checkoutUrl = Regex("""https?://\S*checkout""", RegexOption.IGNORE_CASE)
        sources(play).forEach { f ->
            val text = f.readText()
            assertWithMessage("stripe in ${f.path}").that(text.contains("stripe", ignoreCase = true)).isFalse()
            assertWithMessage("checkout URL in ${f.path}").that(checkoutUrl.containsMatchIn(text)).isFalse()
        }
    }

    @Test
    fun `the phone never acknowledges or consumes a purchase`() {
        sources(play).forEach { f ->
            val text = f.readText()
            listOf("acknowledgePurchase", "consumeAsync", "consumePurchase", "AcknowledgePurchaseParams", "ConsumeParams").forEach {
                assertWithMessage(f.path).that(text).doesNotContain(it)
            }
        }
    }

    @Test
    fun `the direct build has no billing library`() {
        sources(File("src/direct")).forEach { assertThat(it.readText()).doesNotContain("billingclient") }
        sources(File("src/main")).forEach { assertThat(it.readText()).doesNotContain("com.android.billingclient") }
    }

    @Test
    fun `the consent text is word for word the one the server mails`() {
        val server = File("../../server/src/lib/billing-mail.ts").readText()
        val block = server.substringAfter("export const consentText = {").substringBefore("}")
        val expected = Regex("""(\w+): "([^"]+)",""").findAll(block).associate { it.groupValues[1] to it.groupValues[2] }
        assertThat(expected.keys).containsExactly("en", "da", "sv", "nb", "de")
        expected.forEach { (locale, text) ->
            val dir = if (locale == "en") "values" else "values-$locale"
            val xml = File("src/main/res/$dir/strings_billing.xml").readText()
            val app = Regex("""<string name="early_unlock_consent">(.*?)</string>""").find(xml)!!.groupValues[1]
                .replace("\\'", "'").replace("\\\"", "\"")
            assertWithMessage(locale).that(app).isEqualTo(text)
        }
    }
}
