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

    fun read(context: Context, country: PhoneNumbers.Country?): List<DeviceContact> {
        if (!canRead(context)) return emptyList()
        val projection = arrayOf(Phone.CONTACT_ID, Phone.DISPLAY_NAME_PRIMARY, Phone.NUMBER, Phone.NORMALIZED_NUMBER)
        val groups = linkedMapOf<Long, Pair<String, MutableSet<String>>>()
        try {
            context.contentResolver.query(Phone.CONTENT_URI, projection, null, null, Phone.DISPLAY_NAME_PRIMARY)?.use { cursor ->
                while (cursor.moveToNext()) {
                    val number = PhoneNumbers.normalize(cursor.getString(3), country)
                        ?: PhoneNumbers.normalize(cursor.getString(2), country)
                        ?: cursor.getString(2)?.let(PhoneNumberUtils::stripSeparators)?.takeIf { it.isNotEmpty() }
                        ?: continue
                    val name = ContactCodec.cleanName(cursor.getString(1).orEmpty()).ifEmpty { number }
                    val group = groups.getOrPut(cursor.getLong(0)) { name to linkedSetOf() }
                    group.second.add(number)
                }
            }
        } catch (_: SecurityException) {
            return emptyList()
        }
        return groups.values.map { (name, numbers) -> DeviceContact(name, numbers.sorted()) }
    }

    val internationalNumber = Regex("^\\+[1-9][0-9]{6,14}$")
}
