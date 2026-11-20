// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** `ageAgreement` in the rules: the family's words for the child (docs/family-agreement.md). */
@RunWith(RobolectricTestRunner::class)
class AgreementRulesTest {
    private fun rules(extra: String, base: String = rulesJson()) =
        ServerRules.parse(base.replace("\"pollSeconds\":60", "$extra\"pollSeconds\":60"))

    @Test
    fun `an absent block, as from an old server or while it is off, means nothing to show`() {
        assertThat(rules("").agreement).isEqualTo(AgreementRules.NONE)
        assertThat(rules("\"ageAgreement\":{\"lines\":[],\"adultLines\":[],\"onHome\":true},").agreement).isEqualTo(AgreementRules.NONE)
    }

    @Test
    fun `lines and the home switch are read`() {
        val a = rules("\"ageAgreement\":{\"lines\":[\" Phones off at dinner \",\"Ask first\"],\"adultLines\":[\"Parents too\"],\"onHome\":true,\"updatedAt\":null},").agreement
        assertThat(a.lines).containsExactly("Phones off at dinner", "Ask first").inOrder()
        assertThat(a.adultLines).containsExactly("Parents too")
        assertThat(a.onHome).isTrue()
    }

    @Test
    fun `malformed content is dropped and never breaks the rules`() {
        val a = rules("\"ageAgreement\":{\"lines\":[1,null,{\"x\":1},\"  \",\"ok\"],\"adultLines\":\"nope\",\"onHome\":\"yes\"},").agreement
        assertThat(a.lines).containsExactly("ok")
        assertThat(a.adultLines).isEmpty()
        assertThat(a.onHome).isFalse()
        assertThat(rules("\"ageAgreement\":\"text\",").agreement).isEqualTo(AgreementRules.NONE)
        assertThat(rules("\"ageAgreement\":[],").agreement).isEqualTo(AgreementRules.NONE)
    }

    @Test
    fun `the number and length of lines are capped`() {
        val many = (1..12).joinToString(",") { "\"line $it\"" }
        val long = "x".repeat(300)
        val a = rules("\"ageAgreement\":{\"lines\":[$many],\"adultLines\":[$many,\"$long\"]},").agreement
        assertThat(a.lines).hasSize(AgreementRules.MAX_LINES)
        assertThat(a.adultLines).hasSize(AgreementRules.MAX_ADULT_LINES)
        val l = rules("\"ageAgreement\":{\"lines\":[\"$long\"]},").agreement.lines.single()
        assertThat(l).hasLength(AgreementRules.MAX_LENGTH)
    }

    @Test
    fun `only a child phone shows it, and the home screen only when the parents chose so`() {
        val block = "\"ageAgreement\":{\"lines\":[\"a\",\"b\"],\"onHome\":false},"
        val child = rules(block)
        assertThat(AgreementRules.forChild(child).lines).containsExactly("a", "b")
        assertThat(AgreementRules.homeLines(child)).isEmpty()
        assertThat(AgreementRules.homeLines(rules(block.replace("false", "true")))).containsExactly("a", "b")
        assertThat(AgreementRules.forChild(child.copy(profile = "self"))).isEqualTo(AgreementRules.NONE)
        assertThat(AgreementRules.forChild(child.copy(release = true))).isEqualTo(AgreementRules.NONE)
        assertThat(AgreementRules.forChild(null)).isEqualTo(AgreementRules.NONE)
    }
}
