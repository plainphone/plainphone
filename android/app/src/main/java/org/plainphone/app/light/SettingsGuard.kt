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
        /** Words of the uninstall dialog, the only installer screen that is closed. */
        val uninstall: List<String> = UNINSTALL,
    ) {
        companion object {
            /**
             * Actions, not page titles: a list page that only names Plainphone next to "VPN" or
             * "Default apps" (Network & internet, Apps) stays usable. The screens that switch a
             * protection off carry one of these words or Plainphone's own description.
             */
            val BUILT_IN = listOf(
                // English
                "uninstall", "force stop", "clear storage", "clear data", "clear cache", "disable", "deactivate",
                "always-on", "forget vpn", "usage access", "phone app", "sms app",
                // Danish
                "afinstaller", "tving stop", "ryd lagerplads", "ryd data", "deaktiver", "altid aktiveret", "glem vpn",
                "adgang til brug", "brugsadgang", "telefonapp", "sms-app",
            )
            /** In the package installer only the uninstall dialog is closed: updates of Plainphone must install. */
            val UNINSTALL = listOf("uninstall", "afinstaller")
        }
    }

    fun isProtectedScreen(packageName: String, texts: List<String>, k: Keywords): Boolean {
        if (packageName == VPN_DIALOGS) return true
        val lower = texts.map { it.lowercase() }
        if (k.ownDescriptions.any { d -> d.isNotBlank() && lower.any { it.contains(d.lowercase()) } }) return true
        val mentionsUs = lower.any { it.contains(k.appName.lowercase()) }
        if (!mentionsUs) return false
        if (packageName in INSTALLER_PACKAGES) return k.uninstall.any { w -> lower.any { it.contains(w) } }
        if (packageName !in SETTINGS_PACKAGES) return false
        return k.dangerous.any { w -> lower.any { it.contains(w) } }
    }

    /** The keywords a screen shows: tells a page apart from the next one in the same window. */
    fun marks(texts: List<String>, k: Keywords): Set<String> {
        val lower = texts.map { it.lowercase() }
        return (k.ownDescriptions + k.dangerous + k.uninstall)
            .map { it.lowercase() }
            .filter { w -> w.isNotBlank() && lower.any { it.contains(w) } }
            .toSet()
    }
}
