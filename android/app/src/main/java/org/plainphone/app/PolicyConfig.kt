// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.content.Context
import android.os.BaseBundle
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.ContactCodec

/**
 * Everything the lock needs to know. The values come from the provisioning QR
 * code (admin extras bundle) and fall back to [DEFAULT]. Once the phone is paired,
 * [org.plainphone.app.sync.EffectivePolicy] merges the parent's rules from the
 * server on top (app list, DNS host, school time, location) and sets [server].
 */
data class PolicyConfig(
    /** Host for forced private DNS (DNS-over-TLS). Phase 1 placeholder: AdGuard Family. */
    val dnsHost: String = DEFAULT_DNS_HOST,
    /** Packages that stay visible in addition to the resolved core apps. */
    val allowedPackages: Set<String> = DEFAULT_ALLOWED_PACKAGES,
    /** Google account IDs (numeric People API IDs, not email addresses) allowed to unlock FRP. */
    val frpAccountIds: Set<String> = emptySet(),
    /** PBKDF2 hash + salt (hex) of the maintenance PIN. Null means the default test PIN. */
    val pinHashHex: String? = null,
    val pinSaltHex: String? = null,
    /** A maintenance unlock re-locks automatically after this many minutes. */
    val relockMinutes: Int = DEFAULT_RELOCK_MINUTES,
    /** Calling code of the phone's home country ("45"), for numbers written without +code. Null: use the SIM. */
    val countryCallingCode: String? = null,
    /**
     * Approved contacts from the QR code. Only used to seed the contact list at
     * provisioning; afterwards the list lives in [org.plainphone.app.contacts.ContactPolicySource].
     */
    val seedContacts: List<ApprovedContact> = emptyList(),
    /** Where the phone pairs and fetches rules. Self-hosters point their QR code at their own server. */
    val serverUrl: String = DEFAULT_SERVER_URL,
    /**
     * One-time enrollment token from a dashboard-made QR code. Only read at provisioning, then kept
     * sealed in [org.plainphone.app.sync.SyncStore]; never stored in plain text with the config.
     */
    val enrollToken: String? = null,
    /** Set when rules from the server apply; null means the QR code alone decides. */
    val server: ServerOverlay? = null,
    /** Apps whose time is used up today (time limits). Strong mode suspends them. */
    val timeBlocked: Set<String> = emptySet(),
    /**
     * A catalog app being installed right now: app installs are allowed and Play is visible until
     * the app is installed or the install window ends (docs/app-catalog.md, R2).
     */
    val installing: String? = null,
    val installAccountsAllowed: Boolean = false,
) {
    val usesDefaultPin: Boolean get() = pinHashHex == null || pinSaltHex == null

    companion object {
        const val DEFAULT_DNS_HOST = "family.adguard-dns.com"
        const val DEFAULT_RELOCK_MINUTES = 30
        const val DEFAULT_SERVER_URL = "https://app.plainphone.org"
        const val PLAY_STORE = "com.android.vending"

        // Extra apps that stay visible on top of phone, SMS, camera, clock,
        // contacts, launcher, settings and keyboard (resolved at runtime per maker).
        val DEFAULT_ALLOWED_PACKAGES = setOf(
            "com.google.android.apps.messaging",
            "com.samsung.android.messaging",
            "com.google.android.dialer",
            "com.samsung.android.dialer",
            "com.android.chrome", // kept so the DNS filter can be tested in a browser
            "com.google.android.apps.maps",
            "com.google.android.calculator",
            "com.sec.android.app.popupcalculator",
            "com.miui.calculator",
            "com.google.android.calendar",
            "com.samsung.android.calendar",
            "com.sec.android.gallery3d",
            "com.miui.gallery",
            "com.google.android.deskclock",
            "com.sec.android.app.clockpackage",
        )

        val DEFAULT = PolicyConfig()

        // Keys in android.app.extra.PROVISIONING_ADMIN_EXTRAS_BUNDLE (see scripts/provisioning-qr.py).
        const val KEY_DNS_HOST = "plainphone.dns_host"
        const val KEY_ALLOWED = "plainphone.allowed_packages"
        const val KEY_FRP = "plainphone.frp_account_ids"
        const val KEY_PIN_HASH = "plainphone.pin_hash"
        const val KEY_PIN_SALT = "plainphone.pin_salt"
        const val KEY_RELOCK = "plainphone.relock_minutes"
        const val KEY_COUNTRY = "plainphone.country_code"
        const val KEY_CONTACTS = "plainphone.contacts"
        const val KEY_SERVER_URL = "plainphone.server_url"
        const val KEY_ENROLL = "plainphone.enroll"
        private val ENROLL_TOKEN = Regex("^pp_e_[A-Za-z0-9_-]{10,95}$")

        /** Builds a config from the QR admin extras. Unknown or blank values keep the default. */
        @Suppress("DEPRECATION") // BaseBundle.get: QR values may arrive as String, Int or Long.
        fun fromExtras(extras: BaseBundle?): PolicyConfig {
            if (extras == null) return DEFAULT
            fun str(key: String): String? = extras.get(key)?.toString()?.trim()?.takeIf { it.isNotEmpty() }
            val extraAllowed = str(KEY_ALLOWED)?.let(::splitList).orEmpty()
            return PolicyConfig(
                dnsHost = str(KEY_DNS_HOST)?.takeIf(::isValidHost) ?: DEFAULT_DNS_HOST,
                allowedPackages = DEFAULT_ALLOWED_PACKAGES + extraAllowed,
                frpAccountIds = str(KEY_FRP)?.let(::splitList).orEmpty(),
                pinHashHex = str(KEY_PIN_HASH),
                pinSaltHex = str(KEY_PIN_SALT),
                relockMinutes = str(KEY_RELOCK)?.toIntOrNull()?.coerceIn(1, 24 * 60)
                    ?: DEFAULT_RELOCK_MINUTES,
                countryCallingCode = str(KEY_COUNTRY)?.removePrefix("+")?.takeIf { c -> c.length in 1..3 && c.all(Char::isDigit) },
                seedContacts = ContactCodec.decode(str(KEY_CONTACTS)),
                serverUrl = str(KEY_SERVER_URL)?.let(::normalizeServerUrl) ?: DEFAULT_SERVER_URL,
                enrollToken = str(KEY_ENROLL)?.takeIf(ENROLL_TOKEN::matches),
            )
        }

        /**
         * Accepts `https://host[:port][/path]` only: the device token must never travel in clear text.
         * Returns the URL without a trailing slash, or null if it is not acceptable.
         */
        fun normalizeServerUrl(raw: String): String? {
            val uri = runCatching { java.net.URI(raw.trim()) }.getOrNull() ?: return null
            if (uri.scheme?.lowercase() != "https" || uri.host.isNullOrEmpty()) return null
            if (uri.rawQuery != null || uri.rawFragment != null || uri.rawUserInfo != null) return null
            if (!isValidHost(uri.host) && uri.host != "localhost") return null
            return uri.toString().trimEnd('/')
        }

        fun splitList(raw: String): Set<String> =
            raw.split(',', ' ', '\n').map { it.trim() }.filter { it.isNotEmpty() }.toSet()

        private val HOST = Regex("^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\\.)+[a-zA-Z]{2,63}$")
        fun isValidHost(host: String): Boolean = HOST.matches(host)
    }
}

/** Persists the config so it survives reboots. */
class ConfigStore(context: Context) {
    private val prefs = context.getSharedPreferences("plainphone_config", Context.MODE_PRIVATE)

    fun load(): PolicyConfig {
        if (!prefs.getBoolean("saved", false)) return PolicyConfig.DEFAULT
        return PolicyConfig(
            dnsHost = prefs.getString("dns_host", null) ?: PolicyConfig.DEFAULT_DNS_HOST,
            allowedPackages = prefs.getStringSet("allowed", null) ?: PolicyConfig.DEFAULT_ALLOWED_PACKAGES,
            frpAccountIds = prefs.getStringSet("frp", null) ?: emptySet(),
            pinHashHex = prefs.getString("pin_hash", null),
            pinSaltHex = prefs.getString("pin_salt", null),
            relockMinutes = prefs.getInt("relock_minutes", PolicyConfig.DEFAULT_RELOCK_MINUTES),
            countryCallingCode = prefs.getString("country_code", null),
            serverUrl = prefs.getString("server_url", null) ?: PolicyConfig.DEFAULT_SERVER_URL,
        )
    }

    fun save(config: PolicyConfig) {
        prefs.edit()
            .putBoolean("saved", true)
            .putString("dns_host", config.dnsHost)
            .putStringSet("allowed", config.allowedPackages)
            .putStringSet("frp", config.frpAccountIds)
            .putString("pin_hash", config.pinHashHex)
            .putString("pin_salt", config.pinSaltHex)
            .putInt("relock_minutes", config.relockMinutes)
            .putString("country_code", config.countryCallingCode)
            .putString("server_url", config.serverUrl)
            .apply()
    }
}

/**
 * What the parent's rules from the server change in the lock, beyond the app list and DNS host
 * (which are merged straight into [PolicyConfig]).
 */
data class ServerOverlay(
    /** School time or bedtime is on: only core apps plus the window's allowed apps stay visible. */
    val windowActive: Boolean = false,
    /** The parent turned location on: Plainphone gets the location permission and location stays on. */
    val locationRequired: Boolean = false,
)
