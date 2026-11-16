// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PhoneNumbersTest {
    private val dk = PhoneNumbers.countryForIso("DK")
    private val de = PhoneNumbers.countryForIso("de")
    private val us = PhoneNumbers.countryForIso("us")
    private val it = PhoneNumbers.countryForIso("it")

    @Test
    fun `Danish numbers in every common format give the same key`() {
        listOf("12345678", "12 34 56 78", "+45 12 34 56 78", "+4512345678", "0045 12345678", "tel:+45-12-34-56-78", "(+45) 1234 5678")
            .forEach { assertThat(PhoneNumbers.normalize(it, dk)).isEqualTo("+4512345678") }
    }

    @Test
    fun `a foreign number keeps its own country code`() {
        assertThat(PhoneNumbers.normalize("+46 70 123 45 67", dk)).isEqualTo("+46701234567")
        assertThat(PhoneNumbers.normalize("0046701234567", dk)).isEqualTo("+46701234567")
    }

    @Test
    fun `the national trunk prefix is dropped where the country has one`() {
        assertThat(PhoneNumbers.normalize("030 1234567", de)).isEqualTo("+49301234567")
        assertThat(PhoneNumbers.normalize("+49 30 1234567", de)).isEqualTo("+49301234567")
        // Italy keeps the leading 0 internationally.
        assertThat(PhoneNumbers.normalize("06 1234 5678", it)).isEqualTo("+390612345678")
    }

    @Test
    fun `North American numbers`() {
        assertThat(PhoneNumbers.normalize("(212) 555-1234", us)).isEqualTo("+12125551234")
        assertThat(PhoneNumbers.normalize("1 212 555 1234", us)).isEqualTo("+12125551234")
        assertThat(PhoneNumbers.normalize("011 45 12345678", us)).isEqualTo("+4512345678")
    }

    @Test
    fun `short codes are kept as digits`() {
        assertThat(PhoneNumbers.normalize("112", dk)).isEqualTo("112")
        assertThat(PhoneNumbers.normalize("1813", dk)).isEqualTo("1813")
    }

    @Test
    fun `anything that is not a dialable number is rejected`() {
        listOf(null, "", "   ", "*#06#", "abc", "+", "+0451234567", "12345678x", "+1234").forEach {
            assertThat(PhoneNumbers.normalize(it, dk)).isNull()
        }
    }

    @Test
    fun `national numbers cannot be expanded without a country`() {
        assertThat(PhoneNumbers.normalize("12345678", null)).isNull()
        assertThat(PhoneNumbers.normalize("+4512345678", null)).isEqualTo("+4512345678")
    }

    @Test
    fun `country from calling code`() {
        assertThat(PhoneNumbers.countryForCallingCode("+45")).isEqualTo(dk)
        assertThat(PhoneNumbers.countryForCallingCode("49")).isEqualTo(de)
        assertThat(PhoneNumbers.countryForCallingCode("999")?.callingCode).isEqualTo("999")
        assertThat(PhoneNumbers.countryForCallingCode("4x")).isNull()
        assertThat(PhoneNumbers.countryForCallingCode(null)).isNull()
    }

    @Test
    fun `same compares across formats`() {
        assertThat(PhoneNumbers.same("12345678", "+45 12 34 56 78", dk)).isTrue()
        assertThat(PhoneNumbers.same("12345678", "12345679", dk)).isFalse()
        assertThat(PhoneNumbers.same(null, null, dk)).isFalse()
    }
}
