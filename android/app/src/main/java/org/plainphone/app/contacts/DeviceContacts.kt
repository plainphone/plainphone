// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract.CommonDataKinds.Phone
import android.telephony.PhoneNumberUtils

data class DeviceContact(val name: String, val numbers: List<String>)

object DeviceContacts {
    fun canRead(context: Context): Boolean =
        context.checkSelfPermission(Manifest.permission.READ_CONTACTS) == PackageManager.PERMISSION_GRANTED

    fun read(context: Context, country: PhoneNumbers.Country?): List<DeviceContact> =
        readSnapshot(context, country).orEmpty()

    /** A null snapshot means the provider could not be read. */
    fun readSnapshot(
        context: Context,
        country: PhoneNumbers.Country?,
        mostRecentLimit: Int? = null,
    ): List<DeviceContact>? {
        if (!canRead(context)) return null
        val projection = arrayOf(Phone.CONTACT_ID, Phone.DISPLAY_NAME_PRIMARY, Phone.NUMBER, Phone.NORMALIZED_NUMBER)
        val groups = linkedMapOf<Long, Pair<String, MutableSet<String>>>()
        val sortOrder = if (mostRecentLimit == null) Phone.DISPLAY_NAME_PRIMARY
            else "${Phone.CONTACT_LAST_UPDATED_TIMESTAMP} DESC, ${Phone.CONTACT_ID} ASC"
        try {
            context.contentResolver.query(Phone.CONTENT_URI, projection, null, null, sortOrder)?.use { cursor ->
                while (cursor.moveToNext()) {
                    val number = PhoneNumbers.normalize(cursor.getString(3), country)
                        ?: PhoneNumbers.normalize(cursor.getString(2), country)
                        ?: cursor.getString(2)?.let(PhoneNumberUtils::stripSeparators)?.takeIf { it.isNotEmpty() }
                        ?: continue
                    val name = ContactCodec.cleanName(cursor.getString(1).orEmpty()).ifEmpty { number }
                    val id = cursor.getLong(0)
                    if (mostRecentLimit != null && groups.size >= mostRecentLimit && id !in groups) break
                    val group = groups.getOrPut(id) { name to linkedSetOf() }
                    group.second.add(number)
                }
            } ?: return null
        } catch (_: SecurityException) {
            return null
        }
        return groups.values.map { (name, numbers) -> DeviceContact(name, numbers.sorted()) }
    }

    const val SUGGESTION_LIMIT = 2_000

    val internationalNumber = Regex("^\\+[1-9][0-9]{6,14}$")
}
