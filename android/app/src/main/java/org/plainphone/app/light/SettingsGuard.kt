// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

/**
 * Pure: is this window one of the screens that switch Plainphone's protection off? In light mode
 * these are closed unless the maintenance PIN opened a window (docs/light-mode.md):
 * Plainphone's accessibility, VPN, device admin, usage access and default-app screens, its app
 * info page (uninstall, force stop, clear data) and the uninstall dialog.
 *
 * Text matching is the only signal Android gives an accessibility service. The keywords come in
 * English and Danish plus the phone's own Settings strings in its language ([Keywords.fromSettings]).
 */
object SettingsGuard {
    val SETTINGS_PACKAGES = setOf(
        "com.android.settings",
        "com.samsung.android.settings", // not every Samsung uses it, harmless elsewhere
        "com.miui.securitycenter", // Xiaomi's app info and permissions
        "com.coloros.safecenter",
        "com.oplus.safecenter",
    )
    val INSTALLER_PACKAGES = setOf(
        "com.android.packageinstaller",
        "com.google.android.packageinstaller",
        "com.samsung.android.packageinstaller",
        "com.miui.packageinstaller",
    )
    /** The "VPN is active / Disconnect" dialog from the notification. */
    const val VPN_DIALOGS = "com.android.vpndialogs"

    data class Keywords(
        /** Strings only Plainphone's own screens show (its accessibility and device admin descriptions). */
        val ownDescriptions: List<String>,
        val appName: String,
        /** Words that mark a screen that can switch protection off. */
        val dangerous: List<String>,
    ) {
        companion object {
            val BUILT_IN = listOf(
                // English
                "uninstall", "force stop", "clear storage", "clear data", "clear cache", "disable", "deactivate",
                "vpn", "always-on", "accessibility", "device admin", "admin app", "usage access", "default apps",
                "phone app", "sms app", "remove", "turn off",
                // Danish
                "afinstaller", "tving stop", "ryd lagerplads", "ryd data", "deaktiver", "slå fra", "tilgængelighed",
                "hjælpefunktioner", "enhedsadministrator", "administratorapp", "adgang til brug", "brugsadgang",
                "standardapps", "telefonapp", "sms-app", "fjern",
            )
        }
    }

    fun isProtectedScreen(packageName: String, texts: List<String>, k: Keywords): Boolean {
        if (packageName == VPN_DIALOGS) return true
        val lower = texts.map { it.lowercase() }
        if (k.ownDescriptions.any { d -> d.isNotBlank() && lower.any { it.contains(d.lowercase()) } }) return true
        val mentionsUs = lower.any { it.contains(k.appName.lowercase()) }
        if (!mentionsUs) return false
        if (packageName in INSTALLER_PACKAGES) return true
        if (packageName !in SETTINGS_PACKAGES) return false
        return k.dangerous.any { w -> lower.any { it.contains(w) } }
    }
}
