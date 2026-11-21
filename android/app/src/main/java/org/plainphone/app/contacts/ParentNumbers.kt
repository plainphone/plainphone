// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context

/**
 * A small second copy of the parents' numbers that stays readable when the rules cannot be read
 * (docs/always-reachable.md, "When the rules cannot be read"). It lives in device-protected storage,
 * so it opens before the first unlock and does not depend on the rules file, the keystore or the
 * server. Only numbers go in it: no names, no groups, no settings.
 *
 * It holds the parents the server marked. When none is marked, the phone cannot tell who the parents
 * are, so it holds every approved contact, like [org.plainphone.app.sync.Modes.allowedContacts].
 */
class ParentNumbers(context: Context) {
    private val prefs = context.applicationContext.createDeviceProtectedStorageContext()
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** What was last written. [enforced] is whether the contact list was limiting calls at that time. */
    data class Snapshot(val numbers: Set<String>, val callingCode: String?, val enforced: Boolean) {
        /** True when [number] is one of the numbers, whichever way it is written. */
        fun contains(number: String?): Boolean {
            val key = PhoneNumbers.normalize(number, PhoneNumbers.countryForCallingCode(callingCode)) ?: return false
            return key in numbers
        }
    }

    /** Written every time the rules are put together; only touches storage when something changed. */
    fun remember(parents: List<ApprovedContact>, rules: ContactRules) {
        runCatching {
            val country = rules.country
            val numbers = parents.mapNotNull { PhoneNumbers.normalize(it.number, country) }.toSortedSet()
            val text = (listOf(VERSION, rules.enforced.toString(), country?.callingCode.orEmpty()) + numbers).joinToString("\n")
            if (prefs.getString(KEY, null) != text) prefs.edit().putString(KEY, text).apply()
        }
    }

    /** Null when nothing was ever written (first boot, never synced) or the copy cannot be read. */
    fun snapshot(): Snapshot? = runCatching<Snapshot?> {
        val lines = prefs.getString(KEY, null)?.lines() ?: return null
        if (lines.size < 3 || lines[0] != VERSION) return null
        Snapshot(
            numbers = lines.drop(3).filter(String::isNotEmpty).toSet(),
            callingCode = lines[2].ifEmpty { null },
            enforced = lines[1].toBooleanStrict(),
        )
    }.getOrNull()

    private companion object {
        const val PREFS = "plainphone_parent_numbers"
        const val KEY = "list"
        const val VERSION = "v1"
    }
}

/**
 * What an outgoing call does when the rules cannot be read (the read throws). Emergency numbers are
 * always allowed. With a copy of the parents' numbers, only those are allowed. Without one (first
 * boot, never synced) the call goes through, as it always did: a phone that knows nobody must not
 * lock the child out of calling.
 */
object UnreadableRules {
    fun outgoingCall(context: Context, number: String?): Decision {
        val emergency = number != null && runCatching { EmergencyNumbers.forContext(context).isEmergency(number) }
            // The lookup itself failed: every local number counts, a wrong yes costs nothing.
            .getOrElse { EmergencyNumbers.check(number, EmergencyNumbers.localFor(emptyList())) { false } }
        return decide(emergency, ParentNumbers(context).snapshot(), number)
    }

    fun decide(emergency: Boolean, parents: ParentNumbers.Snapshot?, number: String?): Decision = when {
        emergency -> Decision.Allow("emergency number")
        parents == null -> Decision.Allow("rules unreadable and no parent list: calls stay open")
        !parents.enforced -> Decision.Allow("lock not active")
        parents.contains(number) -> Decision.Allow("parent")
        else -> Decision.Block("rules unreadable: only parents and emergency numbers")
    }
}
