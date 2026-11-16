// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.content.Context
import android.os.BaseBundle

/**
 * Everything the lock needs to know. In phase 1 the values come from the
 * provisioning QR code (admin extras bundle) and fall back to [DEFAULT].
 * Phase 3 replaces this with rules from the server.
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
) {
    val usesDefaultPin: Boolean get() = pinHashHex == null || pinSaltHex == null

    companion object {
        const val DEFAULT_DNS_HOST = "family.adguard-dns.com"
        const val DEFAULT_RELOCK_MINUTES = 30

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
            )
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
            .apply()
    }
}
