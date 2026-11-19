// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.net.ConnectivityManager
import android.os.PowerManager
import android.provider.Settings
import org.plainphone.app.light.vpn.PlainphoneVpnService
import org.plainphone.app.time.TimeGuard

/**
 * What protects the phone right now, as reported to the parent (`protections` in
 * `PUT /device/status`, docs/sync-api.md). Pure decisions live in the companion so they are
 * unit-tested; [read] asks Android.
 */
data class Protections(
    val deviceOwner: Boolean,
    val deviceAdmin: Boolean,
    val accessibility: Boolean,
    val usageAccess: Boolean,
    val vpn: Boolean,
    val alwaysOnVpn: Boolean,
    val phoneRole: Boolean,
    val smsRole: Boolean,
    val notifications: Boolean,
    val batteryUnrestricted: Boolean,
    /** False when the user set Private DNS to another resolver, which would go around the filter. */
    val privateDnsOk: Boolean,
) {
    fun toMap(): Map<String, Boolean> = mapOf(
        "deviceOwner" to deviceOwner,
        "deviceAdmin" to deviceAdmin,
        "accessibility" to accessibility,
        "usageAccess" to usageAccess,
        "vpn" to vpn,
        "alwaysOnVpn" to alwaysOnVpn,
        "phoneRole" to phoneRole,
        "smsRole" to smsRole,
        "notifications" to notifications,
        "batteryUnrestricted" to batteryUnrestricted,
        "privateDnsOk" to privateDnsOk,
    )

    /**
     * Light mode: the protections the lock cannot do without. Missing ones make `lockIntact`
     * false, so the parent sees it. Always-on VPN, notifications and battery are recommended
     * but not required (some phones do not offer them).
     */
    fun missingForLight(): List<String> = buildList {
        if (!deviceAdmin) add("device admin")
        if (!accessibility) add("accessibility service")
        if (!vpn) add("DNS filter (VPN)")
        if (!privateDnsOk) add("private DNS points elsewhere")
        if (!phoneRole) add("default phone app")
        if (!smsRole) add("default SMS app")
    }

    companion object {
        fun read(context: Context, filterHost: String?, needsUsageAccess: Boolean): Protections {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            val roles = context.getSystemService(RoleManager::class.java)
            return Protections(
                deviceOwner = dpm?.isDeviceOwnerApp(context.packageName) == true,
                deviceAdmin = dpm?.isAdminActive(LightAdminReceiver.component(context)) == true ||
                    dpm?.isDeviceOwnerApp(context.packageName) == true,
                accessibility = isGuardEnabled(context),
                usageAccess = !needsUsageAccess || TimeGuard.hasUsageAccess(context),
                vpn = PlainphoneVpnService.isRunning(),
                alwaysOnVpn = PlainphoneVpnService.isAlwaysOn(context),
                phoneRole = roles?.isRoleHeld(RoleManager.ROLE_DIALER) == true,
                smsRole = roles?.isRoleHeld(RoleManager.ROLE_SMS) == true,
                notifications = context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() == true,
                batteryUnrestricted = context.getSystemService(PowerManager::class.java)
                    ?.isIgnoringBatteryOptimizations(context.packageName) == true,
                privateDnsOk = privateDnsOk(privateDnsServer(context), filterHost),
            )
        }

        /** Private DNS in "hostname" mode sends every lookup to that host, past the VPN. Only our own host is fine. */
        fun privateDnsOk(serverName: String?, filterHost: String?): Boolean =
            serverName.isNullOrBlank() || serverName.equals(filterHost, ignoreCase = true)

        /** An observation of Android routing, not a test of what the resolver blocks. */
        fun webFilterActive(context: Context, host: String, owner: Boolean): Boolean? = runCatching {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            val link = cm.getLinkProperties(cm.activeNetwork) ?: return null
            val server = link.privateDnsServerName.takeIf { link.isPrivateDnsActive }
            if (owner) server.equals(host, ignoreCase = true)
            else PlainphoneVpnService.activeHost().equals(host, ignoreCase = true) && privateDnsOk(server, host)
        }.getOrNull()

        private fun privateDnsServer(context: Context): String? = runCatching {
            val cm = context.getSystemService(ConnectivityManager::class.java)
            // Plainphone itself is outside its VPN, so this is the real network (Wi-Fi or mobile).
            cm.getLinkProperties(cm.activeNetwork)?.takeIf { it.isPrivateDnsActive }?.privateDnsServerName
        }.getOrNull()

        fun isGuardEnabled(context: Context): Boolean {
            if (GuardService.isConnected) return true
            val enabled = Settings.Secure.getString(context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES) ?: return false
            val me = ComponentName(context, GuardService::class.java)
            return enabled.split(':').any { ComponentName.unflattenFromString(it) == me }
        }
    }
}
