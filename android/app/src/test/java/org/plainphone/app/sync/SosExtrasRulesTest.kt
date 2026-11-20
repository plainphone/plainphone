// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sos.SosSharing
import org.robolectric.RobolectricTestRunner

/** `sos.hidden` and `sos.quickMessages` in the rules (docs/sos.md). Missing means off and none. */
@RunWith(RobolectricTestRunner::class)
class SosExtrasRulesTest {
    private fun rules(sos: String, profile: String = "child", release: Boolean = false) = ServerRules.parse(
        rulesJson(release = release).replace("\"pollSeconds\":60", "\"sos\":$sos,\"pollSeconds\":60")
            .replace("\"profile\":\"child\"", "\"profile\":\"$profile\""),
    )

    private val parents = """"name":"Kim","parents":[{"name":"Mum","number":"+4512345678"}]"""

    @Test
    fun `an older server without the new fields means everything off`() {
        val sos = checkNotNull(rules("{$parents}").sos)
        assertThat(sos.hidden).isEqualTo(HiddenSos.OFF)
        assertThat(sos.hidden.power).isFalse()
        assertThat(sos.hidden.clock).isFalse()
        assertThat(sos.quickMessages).isEqualTo(QuickMessages.NONE)
        assertThat(sos.quickMessages.items).isEmpty()
        assertThat(sos.quickMessages.suggest).isFalse()
    }

    @Test
    fun `hidden SOS and quick messages are read`() {
        val sos = checkNotNull(
            rules(
                """{$parents,
                "hidden":{"power":true,"presses":5,"clock":true,"feedback":"none"},
                "quickMessages":{"enabled":true,"suggest":true,"items":[
                  {"id":"a","text":"Pick me up","meansSos":false},
                  {"id":"b","text":"Did you feed the cat?","meansSos":true}]}}""",
            ).sos,
        )
        assertThat(sos.hidden).isEqualTo(HiddenSos(power = true, presses = 5, clock = true, vibrate = false))
        assertThat(sos.quickMessages.suggest).isTrue()
        assertThat(sos.quickMessages.items).containsExactly(
            QuickMessage("a", "Pick me up", false),
            QuickMessage("b", "Did you feed the cat?", true),
        ).inOrder()
        assertThat(sos.quickMessages.codeWords).containsExactly("Did you feed the cat?")
    }

    @Test
    fun `out of range presses are clamped, unknown feedback vibrates, broken items are skipped`() {
        val sos = checkNotNull(
            rules(
                """{$parents,"hidden":{"power":true,"presses":9,"feedback":"beep"},
                "quickMessages":{"enabled":true,"items":[{"id":"","text":"x"},{"id":"c","text":"  "},{"id":"d","text":"Ok"}]}}""",
            ).sos,
        )
        assertThat(sos.hidden.presses).isEqualTo(6)
        assertThat(sos.hidden.vibrate).isTrue()
        assertThat(sos.quickMessages.suggest).isFalse()
        assertThat(sos.quickMessages.items.map { it.id }).containsExactly("d")
        assertThat(checkNotNull(rules("""{$parents,"hidden":{"presses":1}}""").sos).hidden.presses).isEqualTo(3)
    }

    @Test
    fun `switched off quick messages show nothing, not even code words`() {
        val sos = checkNotNull(
            rules("""{$parents,"quickMessages":{"enabled":false,"suggest":true,"items":[{"id":"a","text":"Hi","meansSos":true}]}}""").sos,
        )
        assertThat(sos.quickMessages.items).isEmpty()
        assertThat(sos.quickMessages.suggest).isFalse()
        assertThat(sos.quickMessages.codeWords).isEmpty()
    }

    @Test
    fun `what can my parents see lists only what is on, and nothing after release`() {
        val on = """{$parents,"hidden":{"power":true,"presses":4,"clock":true},
            "quickMessages":{"enabled":true,"items":[{"id":"a","text":"Blue","meansSos":true},{"id":"b","text":"Ok"}]}}"""
        assertThat(SosSharing.from(rules(on))).isEqualTo(SosSharing(4, true, listOf("Blue"), withPosition = true))
        assertThat(SosSharing.from(rules(on, release = true))).isEqualTo(SosSharing.NONE)
        assertThat(SosSharing.from(rules("{$parents}"))).isEqualTo(SosSharing(withPosition = true))
    }
}
