// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import android.telephony.TelephonyManager

/** Decides whether a number is an emergency number that must always work. */
fun interface EmergencyCheck {
    fun isEmergency(number: String): Boolean
}

object EmergencyNumbers {
    /**
     * Always allowed, in every country, even if the SIM or network does not
     * report them: 112 and 911 (GSM standard, routed to emergency services by
     * every phone) and 114 (Danish police, non-urgent).
     */
    val ALWAYS: Set<String> = setOf("112", "911", "114")

    /** Static part of the check, so it is unit-testable. [network] is the phone's own list. */
    fun check(number: String, network: (String) -> Boolean): Boolean {
        val digits = number.trim().removePrefix("tel:").filter { it.isDigit() || it == '+' || it == '*' || it == '#' }
        if (digits.isEmpty()) return false
        if (digits in ALWAYS) return true
        return runCatching { network(digits) }.getOrDefault(false)
    }

    /** Uses Android's list for the current SIM and network (covers 999, 000, 110, 119 and so on). */
    fun forContext(context: Context): EmergencyCheck {
        val tm = context.getSystemService(TelephonyManager::class.java)
        return EmergencyCheck { number -> check(number) { tm?.isEmergencyNumber(it) == true } }
    }
}
