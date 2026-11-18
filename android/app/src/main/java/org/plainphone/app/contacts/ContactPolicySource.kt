// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.telephony.TelephonyManager
import android.util.Log
import java.time.Instant
import org.plainphone.app.light.LightRelease
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.Mode
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.sync.SyncStore

/**
 * Where the approved-contacts list comes from. Before pairing it lives on the phone
 * (QR code + maintenance screen); once the phone has rules from the parent's
 * dashboard, [SyncedContactPolicySource] takes the list from there. Callers only ever read [rules].
 */
interface ContactPolicySource {
    /** The current rules. Must be cheap: it runs for every call and message. */
    fun rules(): ContactRules
}

/** A source the phone itself can change (behind the maintenance PIN). */
interface EditableContactPolicySource : ContactPolicySource {
    fun add(contact: ApprovedContact): Result<ApprovedContact>
    fun remove(number: String)
    /** True when the list is managed in the parent's dashboard and cannot be edited on the phone. */
    val managedRemotely: Boolean get() = false
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

    override fun rules(): ContactRules {
        val country = country()
        resolvePending(country)
        return ContactRules(
            enforced = isLocked(),
            contacts = ContactCodec.decode(prefs.getString(KEY_CONTACTS, null)),
            country = country,
            help = Helplines.forCountry(app, Helplines.country(country)),
            replyAgeMs = HelpReplies(app)::ageMs,
        )
    }

    override fun add(contact: ApprovedContact): Result<ApprovedContact> = synchronized(LOCK) {
        val country = country()
        return ContactList.add(rules().contacts, contact, country).map { list ->
            save(list)
            list.first { it.number == PhoneNumbers.normalize(contact.number, country) }
        }
    }

    override fun remove(number: String) = synchronized(LOCK) {
        save(ContactList.remove(rules().contacts, number, country()))
    }

    /**
     * Seeds the list from the QR code. Only on first provisioning, so a re-scan never wipes edits.
     * Numbers written without +code that cannot be expanded yet (no SIM during setup) are kept
     * as pending and added as soon as the phone's country is known.
     */
    fun seedIfEmpty(contacts: List<ApprovedContact>) {
        if (prefs.contains(KEY_CONTACTS) || contacts.isEmpty()) return
        val country = country()
        var list = emptyList<ApprovedContact>()
        val pending = mutableListOf<ApprovedContact>()
        for (c in contacts) {
            ContactList.add(list, c, country).onSuccess { list = it }.onFailure { pending += c }
        }
        prefs.edit().putString(KEY_PENDING, ContactCodec.encode(pending)).apply()
        save(list)
    }

    /** Contacts from the QR code still waiting for the phone's country. */
    fun pending(): List<ApprovedContact> = ContactCodec.decode(prefs.getString(KEY_PENDING, null))

    private fun resolvePending(country: PhoneNumbers.Country?): Unit = synchronized(LOCK) {
        if (country == null) return
        val pending = pending()
        if (pending.isEmpty()) return
        var list = ContactCodec.decode(prefs.getString(KEY_CONTACTS, null))
        for (c in pending) {
            // A number that still fails with a known country is not a phone number: drop it.
            ContactList.add(list, c, country).onSuccess { list = it }
                .onFailure { Log.w("Plainphone", "dropped a QR contact that is not a phone number") }
        }
        prefs.edit().remove(KEY_PENDING).apply()
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
        private const val KEY_PENDING = "pending_seed"
        /** Instances are cheap and short-lived; one process-wide lock keeps read-change-save atomic. */
        private val LOCK = Any()
    }
}

/**
 * Phase 4: once the phone has rules from the server, the parent's list from the dashboard
 * applies (also offline: the last rules are stored). Until then, the local list.
 */
class SyncedContactPolicySource(
    context: Context,
    private val serverContacts: (() -> List<ApprovedContact>?)? = null,
) : EditableContactPolicySource {
    private val app = context.applicationContext
    private val local = LocalContactPolicySource(app)
    private val store = SyncStore(app)

    override fun rules(): ContactRules {
        val base = local.rules()
        val server = store.rules()
        val fromServer = (if (serverContacts != null) serverContacts.invoke() else server?.contacts) ?: return base
        val controlled = base.enforced || (Mode.isLight(app) && LightSetup.isComplete(app) &&
            !LightRelease.isReleased(app) && !Lock.isInMaintenanceWindow(app))
        val synced = base.copy(enforced = controlled, contacts = fromServer, childProfile = server?.profile == "child")
        return if (server?.profile == "self") {
            val restriction = server.selfScheduleContacts
            // Before this setting existed, only a locked Device Owner enforced the list.
            val self = if (restriction == null) synced.copy(enforced = base.enforced) else synced
            selfTelephonyRules(self, restriction, server.schedules, server.timezone, Instant.now())
        } else synced
    }

    override val managedRemotely: Boolean
        get() = if (serverContacts != null) serverContacts.invoke() != null else store.rules() != null

    override fun add(contact: ApprovedContact): Result<ApprovedContact> =
        if (managedRemotely) Result.failure(IllegalStateException("managed in the parent's dashboard")) else local.add(contact)

    override fun remove(number: String) {
        if (!managedRemotely) local.remove(number)
    }
}

/** The one source the app uses. */
object ContactPolicySources {
    fun get(context: Context): EditableContactPolicySource = SyncedContactPolicySource(context)
}
