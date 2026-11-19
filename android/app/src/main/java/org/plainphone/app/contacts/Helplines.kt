// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import android.content.res.Resources
import java.util.Locale
import org.json.JSONObject

enum class Inbound { NONE, REPLY_ONLY }

data class Helpline(
    val name: String,
    val phone: String?,
    val sms: String?,
    val website: String?,
    val phoneInbound: Inbound = Inbound.NONE,
    val smsInbound: Inbound = Inbound.NONE,
    val smsReplyHours: Int = 24,
)

data class HelpDirectory(
    val lines: List<Helpline> = emptyList(),
    val information: List<Helpline> = emptyList(),
    val domains: Set<String> = emptySet(),
    val exactHosts: Set<String> = emptySet(),
) {
    fun contactFor(
        number: String?,
        country: PhoneNumbers.Country?,
        channel: Channel,
        replyOnly: Boolean = false,
    ): ApprovedContact? {
        if (number == null || number.any(Char::isLetter)) return null
        return lines.firstNotNullOfOrNull { line ->
            val (endpoint, inbound) = when (channel) {
                Channel.CALL -> line.phone to line.phoneInbound
                Channel.SMS -> line.sms to line.smsInbound
            }
            endpoint?.takeIf {
                (!replyOnly || inbound == Inbound.REPLY_ONLY) && PhoneNumbers.same(it, number, country)
            }?.let { ApprovedContact(line.name, it) }
        }
    }

    fun replyWindowMs(contact: ApprovedContact, channel: Channel): Long {
        val hours = if (channel == Channel.SMS) lines.firstOrNull { it.sms == contact.number }?.smsReplyHours else null
        return (hours ?: 24) * 60 * 60_000L
    }

    fun contains(number: String?, country: PhoneNumbers.Country?): Boolean =
        Channel.entries.any { contactFor(number, country, it) != null }

    fun allowsHost(host: String?): Boolean {
        val name = host?.lowercase(Locale.ROOT)?.trimEnd('.') ?: return false
        return name in exactHosts || domains.any { name == it || name.endsWith(".$it") }
    }
}

object Helplines {
    private val directories = mutableMapOf<String, HelpDirectory>()

    fun country(configured: PhoneNumbers.Country?): PhoneNumbers.Country? =
        configured ?: PhoneNumbers.countryForIso(Resources.getSystem().configuration.locales[0]?.country)

    @Synchronized
    fun forCountry(context: Context, country: PhoneNumbers.Country?): HelpDirectory {
        val iso = PhoneNumbers.COUNTRIES.entries.firstOrNull { it.value == country }?.key ?: return HelpDirectory()
        return directories.getOrPut(iso) {
            val path = "$iso.json"
            if (path !in context.assets.list("").orEmpty()) return@getOrPut HelpDirectory()
            val data = JSONObject(context.assets.open(path).bufferedReader().use { it.readText() })
            val domains = mutableSetOf<String>()
            val exactHosts = mutableSetOf<String>()
            fun entries(key: String): List<Helpline> {
                val array = data.getJSONArray(key)
                return List(array.length()) { index ->
                    val entry = array.getJSONObject(index)
                    val hosts = entry.getJSONArray("domains")
                    for (i in 0 until hosts.length()) domains += hosts.getString(i)
                    entry.optJSONArray("exactHosts")?.let { exact ->
                        for (i in 0 until exact.length()) exactHosts += exact.getString(i)
                    }
                    fun inbound(channel: String) =
                        if (entry.optJSONObject("inbound")?.optString(channel) == "replyOnly") Inbound.REPLY_ONLY
                        else Inbound.NONE
                    Helpline(
                        entry.getString("name"),
                        entry.optString("phone").takeUnless { entry.isNull("phone") },
                        entry.optString("sms").takeUnless { entry.isNull("sms") },
                        entry.getString("source").takeIf { hosts.length() > 0 },
                        inbound("phone"),
                        inbound("sms"),
                        entry.optInt("smsReplyHours", 24).coerceIn(1, 120),
                    )
                }
            }
            HelpDirectory(entries("helplines"), entries("information"), domains, exactHosts)
        }
    }
}
