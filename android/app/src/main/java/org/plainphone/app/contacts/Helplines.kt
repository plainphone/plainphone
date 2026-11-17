// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import java.util.Locale
import org.json.JSONObject

data class Helpline(
    val name: String,
    val phone: String?,
    val sms: String?,
    val website: String?,
)

data class HelpDirectory(
    val lines: List<Helpline> = emptyList(),
    val information: List<Helpline> = emptyList(),
    val domains: Set<String> = emptySet(),
) {
    fun contactFor(number: String?, country: PhoneNumbers.Country?, channel: Channel): ApprovedContact? {
        return lines.firstNotNullOfOrNull { line ->
            val endpoint = if (channel == Channel.CALL) line.phone else line.sms
            endpoint?.takeIf { PhoneNumbers.same(it, number, country) }?.let { ApprovedContact(line.name, it) }
        }
    }

    fun contains(number: String?, country: PhoneNumbers.Country?): Boolean =
        Channel.entries.any { contactFor(number, country, it) != null }

    fun allowsHost(host: String?): Boolean {
        val name = host?.lowercase(Locale.ROOT)?.trimEnd('.') ?: return false
        return domains.any { name == it || name.endsWith(".$it") }
    }
}

object Helplines {
    private val directories = mutableMapOf<String, HelpDirectory>()

    fun country(configured: PhoneNumbers.Country?): PhoneNumbers.Country? =
        configured ?: PhoneNumbers.countryForIso(Locale.getDefault().country)

    @Synchronized
    fun forCountry(context: Context, country: PhoneNumbers.Country?): HelpDirectory {
        val iso = PhoneNumbers.COUNTRIES.entries.firstOrNull { it.value == country }?.key ?: return HelpDirectory()
        return directories.getOrPut(iso) {
            val path = "$iso.json"
            if (path !in context.assets.list("").orEmpty()) return@getOrPut HelpDirectory()
            val data = JSONObject(context.assets.open(path).bufferedReader().use { it.readText() })
            val domains = mutableSetOf<String>()
            fun entries(key: String): List<Helpline> {
                val array = data.getJSONArray(key)
                return List(array.length()) { index ->
                    val entry = array.getJSONObject(index)
                    val hosts = entry.getJSONArray("domains")
                    for (i in 0 until hosts.length()) domains += hosts.getString(i)
                    Helpline(
                        entry.getString("name"),
                        entry.optString("phone").takeUnless { entry.isNull("phone") },
                        entry.optString("sms").takeUnless { entry.isNull("sms") },
                        entry.getString("source").takeIf { hosts.length() > 0 },
                    )
                }
            }
            HelpDirectory(entries("helplines"), entries("information"), domains)
        }
    }
}
