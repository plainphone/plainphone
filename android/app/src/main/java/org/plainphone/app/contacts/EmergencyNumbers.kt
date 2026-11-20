// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import android.telephony.TelephonyManager
import org.plainphone.app.ConfigStore

/** Decides whether a number is an emergency number that must always work. */
fun interface EmergencyCheck {
    fun isEmergency(number: String): Boolean

    /**
     * True for numbers that reach an emergency service which may call back.
     * Non-urgent lines such as 114 can always be called, but calling them must
     * not open the call-back window (a child could dial 114 and hang up).
     */
    fun opensCallBackWindow(number: String): Boolean =
        isEmergency(number) && EmergencyNumbers.digits(number) !in EmergencyNumbers.NON_URGENT
}

object EmergencyNumbers {
    /**
     * Always allowed, in every country, even if the SIM or network does not
     * report them: 112 and 911 (GSM standard, routed to emergency services by
     * every phone) and 114 (Danish police, non-urgent).
     */
    val ALWAYS: Set<String> = setOf("112", "911", "114")

    /** Always callable, but not an emergency service: no call-back window. */
    val NON_URGENT: Set<String> = setOf("114")

    fun digits(number: String): String =
        number.trim().removePrefix("tel:").filter { it.isDigit() || it == '+' || it == '*' || it == '#' }

    /**
     * Local emergency numbers of the countries Plainphone is translated for (da, sv, nb, de, en), by ISO
     * country. A floor under Android's list, which depends on the SIM and the network: with no SIM, a
     * foreign SIM or no signal Android may not know 113 in Norway or 999 in the UK (docs/always-reachable.md).
     */
    val LOCAL: Map<String, Set<String>> = mapOf(
        "dk" to setOf("112", "114"),
        "se" to setOf("112"),
        "no" to setOf("110", "112", "113"),
        "de" to setOf("110", "112"),
        "gb" to setOf("112", "999"),
        "us" to setOf("911"),
    )

    /**
     * The local numbers for the countries the phone may be in. When the phone cannot tell where it is
     * ([countries] is empty), every local number counts: a wrong yes costs nothing, a wrong no could. A
     * country the phone knows but that is not listed (Finland, say) adds nothing: Android's own list decides.
     */
    fun localFor(countries: Collection<String?>): Set<String> {
        if (countries.isEmpty()) return LOCAL.values.flatten().toSet()
        return countries.mapNotNull { LOCAL[it?.lowercase()] }.flatten().toSet()
    }

    /** Static part of the check, so it is unit-testable. [network] is the phone's own list. */
    fun check(number: String, local: Set<String> = emptySet(), network: (String) -> Boolean): Boolean {
        val digits = digits(number)
        if (digits.isEmpty()) return false
        if (digits in ALWAYS || digits in local) return true
        return runCatching { network(digits) }.getOrDefault(false)
    }

    /**
     * Uses Android's list for the current SIM and network (covers 999, 000, 110, 119 and so on), and the
     * local numbers of the SIM, network, QR code and system language countries when Android's list is short.
     */
    fun forContext(context: Context): EmergencyCheck {
        val tm = runCatching { context.getSystemService(TelephonyManager::class.java) }.getOrNull()
        return EmergencyCheck { number ->
            // The always-on numbers first, with no lookups that could throw on the most critical path.
            if (digits(number) in ALWAYS) return@EmergencyCheck true
            // Where the phone is, not which language it speaks: an English phone can have a Norwegian SIM.
            // If a lookup fails, every local number counts.
            val local = runCatching {
                val configured = PhoneNumbers.countryForCallingCode(ConfigStore(context).load().countryCallingCode)
                localFor(
                    listOf(
                        tm?.simCountryIso, tm?.networkCountryIso,
                        PhoneNumbers.COUNTRIES.entries.firstOrNull { it.value == configured }?.key,
                    ).filterNot { it.isNullOrBlank() },
                )
            }.getOrElse { localFor(emptyList()) }
            check(number, local) { tm?.isEmergencyNumber(it) == true }
        }
    }
}
