// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

/**
 * Turns the many ways a number can be written ("12 34 56 78", "+45 12345678",
 * "0045-12345678") into one comparable key, so the approved-contacts check
 * cannot be fooled by formatting.
 *
 * Pure Kotlin on purpose: libphonenumber would add 4 MB for a check that only
 * needs to compare a handful of numbers. The trade-off is that national
 * numbers are only expanded for the countries in [COUNTRIES]; anything else must
 * be stored with its +country code.
 */
object PhoneNumbers {

    /** A country's calling code and its national trunk prefix ("0" in Germany, none in Denmark). */
    data class Country(val callingCode: String, val trunkPrefix: String?)

    /** ISO 3166 alpha-2 (lower case) to calling code. Extend as phones are tested in more countries. */
    val COUNTRIES: Map<String, Country> = mapOf(
        "dk" to Country("45", null),
        "no" to Country("47", null),
        "se" to Country("46", "0"),
        "fi" to Country("358", "0"),
        "is" to Country("354", null),
        "de" to Country("49", "0"),
        "nl" to Country("31", "0"),
        "be" to Country("32", "0"),
        "lu" to Country("352", null),
        "fr" to Country("33", "0"),
        "gb" to Country("44", "0"),
        "ie" to Country("353", "0"),
        "at" to Country("43", "0"),
        "ch" to Country("41", "0"),
        "it" to Country("39", null), // Italian numbers keep their leading 0 internationally.
        "es" to Country("34", null),
        "pt" to Country("351", null),
        "pl" to Country("48", null),
        "cz" to Country("420", null),
        "gr" to Country("30", null),
        "ee" to Country("372", null),
        "lv" to Country("371", null),
        "us" to Country("1", "1"),
        "ca" to Country("1", "1"),
        "au" to Country("61", "0"),
        "nz" to Country("64", "0"),
    )

    /** Numbers this short are service or emergency codes and are compared as they are. */
    const val MAX_SHORT_CODE_LENGTH = 6

    private const val MIN_E164_DIGITS = 7
    private const val MAX_E164_DIGITS = 15
    private val SEPARATORS = Regex("[\\s\\-./()\\u00a0]")

    fun countryForIso(iso: String?): Country? = iso?.lowercase()?.let(COUNTRIES::get)

    fun countryForCallingCode(code: String?): Country? {
        val digits = code?.trim()?.removePrefix("+") ?: return null
        if (digits.isEmpty() || !digits.all(Char::isDigit)) return null
        // Prefer a country whose trunk prefix we know; fall back to "no trunk prefix".
        return COUNTRIES.values.firstOrNull { it.callingCode == digits } ?: Country(digits, null)
    }

    /**
     * The comparable form of [raw]: "+4512345678" for full numbers, plain digits
     * for short codes ("112", "1813"), or null if it is not a dialable number
     * (letters, "*#06#", empty, hidden caller).
     *
     * @param country the phone's home country, used to expand national numbers
     */
    fun normalize(raw: String?, country: Country?): String? {
        if (raw == null) return null
        var s = raw.trim().removePrefix("tel:").replace(SEPARATORS, "")
        if (s.isEmpty()) return null
        if (s.startsWith("+")) {
            s = s.substring(1)
            return if (isDigits(s) && s.length in MIN_E164_DIGITS..MAX_E164_DIGITS && s[0] != '0') "+$s" else null
        }
        if (!isDigits(s)) return null
        if (s.length <= MAX_SHORT_CODE_LENGTH) return s

        // International prefixes: 00 (most of the world), 011 (North America).
        if (s.startsWith("00")) return normalize("+" + s.substring(2), country)
        if (country?.callingCode == "1" && s.startsWith("011")) return normalize("+" + s.substring(3), country)

        if (country == null) return null
        val national = when {
            country.trunkPrefix != null && s.startsWith(country.trunkPrefix) -> s.substring(country.trunkPrefix.length)
            else -> s
        }
        return normalize("+" + country.callingCode + national, null)
    }

    /** True when both numbers normalize to the same key. */
    fun same(a: String?, b: String?, country: Country?): Boolean {
        val na = normalize(a, country) ?: return false
        return na == normalize(b, country)
    }

    private fun isDigits(s: String) = s.isNotEmpty() && s.all { it in '0'..'9' }
}
