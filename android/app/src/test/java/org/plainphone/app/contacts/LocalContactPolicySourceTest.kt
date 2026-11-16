// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.plainphone.app.PolicyConfig
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class LocalContactPolicySourceTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    private fun source(): LocalContactPolicySource {
        ConfigStore(context).save(PolicyConfig(countryCallingCode = "45"))
        return LocalContactPolicySource(context)
    }

    @Test
    fun `added contacts survive a new instance and are stored normalized`() {
        source().add(ApprovedContact("Mum", "12 34 56 78")).getOrThrow()
        val rules = LocalContactPolicySource(context).rules()
        assertThat(rules.contacts).containsExactly(ApprovedContact("Mum", "+4512345678"))
        assertThat(rules.country?.callingCode).isEqualTo("45")
    }

    @Test
    fun `remove takes the contact off the list`() {
        val s = source()
        s.add(ApprovedContact("Mum", "+4512345678"))
        s.add(ApprovedContact("Dad", "+4587654321"))
        s.remove("12345678")
        assertThat(s.rules().contacts.map { it.name }).containsExactly("Dad")
    }

    @Test
    fun `the QR seed is used once and never wipes later edits`() {
        val s = source()
        s.seedIfEmpty(listOf(ApprovedContact("Mum", "12345678")))
        s.add(ApprovedContact("Dad", "+4587654321"))
        s.seedIfEmpty(listOf(ApprovedContact("Stranger", "+4511111111")))
        assertThat(s.rules().contacts.map { it.name }).containsExactly("Dad", "Mum")
    }

    @Test
    fun `seed numbers without a country wait until the country is known`() {
        ConfigStore(context).save(PolicyConfig(countryCallingCode = null))
        val s = LocalContactPolicySource(context)
        s.seedIfEmpty(listOf(ApprovedContact("Mum", "+4512345678"), ApprovedContact("Dad", "87654321")))
        // Robolectric has no SIM country, so Dad cannot be expanded yet.
        assertThat(s.rules().contacts.map { it.name }).containsExactly("Mum")
        assertThat(s.pending().map { it.name }).containsExactly("Dad")

        ConfigStore(context).save(PolicyConfig(countryCallingCode = "45"))
        assertThat(s.rules().contacts).contains(ApprovedContact("Dad", "+4587654321"))
        assertThat(s.pending()).isEmpty()
    }

    @Test
    fun `rules are not enforced without Device Owner`() {
        assertThat(source().rules().enforced).isFalse()
    }
}
