// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.telephony.TelephonyManager
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock

/**
 * Where the approved-contacts list comes from. Phase 2 keeps it on the phone
 * (QR code + maintenance screen); phase 3 adds a source that syncs it from the
 * parent's dashboard. Callers only ever read [rules].
 */
interface ContactPolicySource {
    /** The current rules. Must be cheap: it runs for every call and message. */
    fun rules(): ContactRules
}

/** A source the phone itself can change (behind the maintenance PIN). */
interface EditableContactPolicySource : ContactPolicySource {
    fun add(contact: ApprovedContact): Result<ApprovedContact>
    fun remove(number: String)
}

/** Text form of the list, used in SharedPreferences and in the QR code extra. */
object ContactCodec {
    private const val ENTRY_SEPARATOR = ';'
    private const val FIELD_SEPARATOR = '='

    /** "Mum=+4512345678;Dad=+4587654321". A missing name falls back to the number. */
    fun decode(raw: String?): List<ApprovedContact> = raw.orEmpty()
        .split(ENTRY_SEPARATOR, '\n')
        .map { it.trim() }
        .filter { it.isNotEmpty() }
        .map { entry ->
            val cut = entry.lastIndexOf(FIELD_SEPARATOR)
            if (cut < 0) {
                ApprovedContact(entry, entry)
            } else {
                val name = entry.substring(0, cut).trim()
                val number = entry.substring(cut + 1).trim()
                ApprovedContact(name.ifEmpty { number }, number)
            }
        }
        .filter { it.number.isNotEmpty() }

    fun encode(contacts: List<ApprovedContact>): String =
        contacts.joinToString(ENTRY_SEPARATOR.toString()) { "${cleanName(it.name)}$FIELD_SEPARATOR${it.number.trim()}" }

    /** Names must not contain the separators; everything else is kept. */
    fun cleanName(name: String): String =
        name.replace(Regex("[;=\\n\\r\\t]"), " ").replace(Regex(" +"), " ").trim().take(60)
}

/** Pure list operations, kept apart from storage so they are unit-tested. */
object ContactList {
    fun add(list: List<ApprovedContact>, contact: ApprovedContact, country: PhoneNumbers.Country?): Result<List<ApprovedContact>> {
        val key = PhoneNumbers.normalize(contact.number, country)
            ?: return Result.failure(IllegalArgumentException("Not a phone number: ${contact.number}"))
        val cleaned = ApprovedContact(ContactCodec.cleanName(contact.name).ifEmpty { key }, key)
        val rest = list.filterNot { PhoneNumbers.normalize(it.number, country) == key }
        return Result.success((rest + cleaned).sortedBy { it.name.lowercase() })
    }

    fun remove(list: List<ApprovedContact>, number: String, country: PhoneNumbers.Country?): List<ApprovedContact> {
        val key = PhoneNumbers.normalize(number, country) ?: number
        return list.filterNot { (PhoneNumbers.normalize(it.number, country) ?: it.number) == key }
    }
}

/** Phase 2 source: the list lives in the app's private storage. */
class LocalContactPolicySource(context: Context) : EditableContactPolicySource {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    override fun rules(): ContactRules = ContactRules(
        enforced = isLocked(),
        contacts = ContactCodec.decode(prefs.getString(KEY_CONTACTS, null)),
        country = country(),
    )

    override fun add(contact: ApprovedContact): Result<ApprovedContact> {
        val country = country()
        return ContactList.add(rules().contacts, contact, country).map { list ->
            save(list)
            list.first { it.number == PhoneNumbers.normalize(contact.number, country) }
        }
    }

    override fun remove(number: String) = save(ContactList.remove(rules().contacts, number, country()))

    /** Seeds the list from the QR code. Only on first provisioning, so a re-scan never wipes edits. */
    fun seedIfEmpty(contacts: List<ApprovedContact>) {
        if (prefs.contains(KEY_CONTACTS) || contacts.isEmpty()) return
        var list = emptyList<ApprovedContact>()
        for (c in contacts) list = ContactList.add(list, c, country()).getOrDefault(list)
        save(list)
    }

    private fun save(list: List<ApprovedContact>) {
        prefs.edit().putString(KEY_CONTACTS, ContactCodec.encode(list)).apply()
    }

    private fun isLocked(): Boolean {
        val dpm = app.getSystemService(DevicePolicyManager::class.java)
        return dpm?.isDeviceOwnerApp(app.packageName) == true && !Lock.isInMaintenanceWindow(app)
    }

    /** QR code's country code first, then the SIM, then the network. */
    private fun country(): PhoneNumbers.Country? {
        PhoneNumbers.countryForCallingCode(ConfigStore(app).load().countryCallingCode)?.let { return it }
        val tm = app.getSystemService(TelephonyManager::class.java) ?: return null
        return PhoneNumbers.countryForIso(tm.simCountryIso.takeIf { !it.isNullOrEmpty() })
            ?: PhoneNumbers.countryForIso(tm.networkCountryIso.takeIf { !it.isNullOrEmpty() })
    }

    companion object {
        private const val PREFS = "plainphone_contacts"
        private const val KEY_CONTACTS = "approved"
    }
}

/** The one source the app uses. Phase 3 swaps this for the server-backed source. */
object ContactPolicySources {
    fun get(context: Context): EditableContactPolicySource = LocalContactPolicySource(context)
}
