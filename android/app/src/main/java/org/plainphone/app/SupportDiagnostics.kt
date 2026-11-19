// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app

import org.json.JSONArray
import org.json.JSONObject

internal object SupportDiagnostics {
    private val versionPattern = Regex("""\d{1,5}(?:\.\d{1,5}){0,3}""")

    fun version(value: String): String? = value.takeIf(versionPattern::matches)

    fun format(appVersion: String, androidVersion: String, light: Boolean, failedPolicies: List<String>): String =
        JSONObject()
            .put("appVersion", version(appVersion) ?: JSONObject.NULL)
            .put("androidVersion", version(androidVersion) ?: JSONObject.NULL)
            .put("mode", if (light) "light" else "strong")
            .put("failedPolicies", JSONArray(failedPolicies.map(::policy).distinct()))
            .toString(2)

    private fun policy(step: String) = when {
        step in policyNames -> step
        step.startsWith("extra users and profiles:") -> "extra users and profiles"
        else -> "other"
    }

    // Match the safe policy names in web/src/lib/failedPolicies.ts; exclude runtime details.
    private val policyNames = setOf(
        "Chrome managed config (no DoH, no incognito, SafeSearch)",
        "DNS filter (VPN)",
        "accessibility service (closes blocked apps)",
        "accounts on the phone",
        "automatic date and time",
        "battery exemption missing: self-update cannot run",
        "block apps outside the allowlist",
        "block uninstall of Plainphone",
        "bootloader warning",
        "call redirection role",
        "call screening role",
        "contacts permission for call screening",
        "default SMS app",
        "default phone app",
        "device admin (uninstall needs it switched off first)",
        "device owner",
        "enable call role services",
        "extra users and profiles",
        "factory reset protection",
        "hardware attestation",
        "hardware attestation: custom-os",
        "hardware attestation: failed-boot",
        "hardware attestation: unlocked",
        "hide apps outside the allowlist",
        "hide apps outside the allowlist (school time or bedtime)",
        "home screen",
        "install window: clear no_install_apps",
        "light mode switched off with the PIN",
        "location on",
        "location permission",
        "location setting free",
        "no force stop of Plainphone",
        "no lock screen widgets",
        "only built-in accessibility services",
        "only built-in keyboards",
        "phone and SMS permissions",
        "phone settings left to the user",
        "private DNS",
        "private DNS not pointing elsewhere",
        "restriction disallow_config_default_apps",
        "restriction disallow_config_private_dns",
        "restriction no_add_clone_profile",
        "restriction no_add_managed_profile",
        "restriction no_add_private_profile",
        "restriction no_add_user",
        "restriction no_assist_content",
        "restriction no_config_credentials",
        "restriction no_config_date_time",
        "restriction no_config_location",
        "restriction no_config_vpn",
        "restriction no_content_capture",
        "restriction no_content_suggestions",
        "restriction no_debugging_features",
        "restriction no_factory_reset",
        "restriction no_install_apps",
        "restriction no_install_unknown_sources",
        "restriction no_install_unknown_sources_globally",
        "restriction no_modify_accounts",
        "restriction no_network_reset",
        "restriction no_physical_media",
        "restriction no_safe_boot",
        "restriction no_usb_file_transfer",
        "restriction no_user_switch",
        "time limits",
        "usage access (time limits)",
    )
}
