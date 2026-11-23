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
import org.plainphone.app.distribution.Distribution
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
    val usageAccessGranted: Boolean = usageAccess,
) {
    /** The Play edition has no device admin, so it leaves [deviceAdmin] out instead of reporting it off. */
    fun toMap(): Map<String, Boolean> = mapOf(
        "deviceOwner" to deviceOwner,
        "deviceAdmin" to deviceAdmin,
        "accessibility" to accessibility,
        "usageAccess" to usageAccess,
        "usageAccessGranted" to usageAccessGranted,
        "vpn" to vpn,
        "alwaysOnVpn" to alwaysOnVpn,
        "phoneRole" to phoneRole,
        "smsRole" to smsRole,
        "notifications" to notifications,
        "batteryUnrestricted" to batteryUnrestricted,
        "privateDnsOk" to privateDnsOk,
    ).let { if (Distribution.DEVICE_ADMIN) it else it - "deviceAdmin" }

    /**
     * Light mode: the protections the lock cannot do without. Missing ones make `lockIntact`
     * false, so the parent sees it. Always-on VPN, notifications and battery are recommended
     * but not required (some phones do not offer them).
     */
    fun missingForLight(
        method: FilterMethod = FilterMethod.VPN,
        dnsIssue: String? = null,
    ): List<String> = buildList {
        if (Distribution.DEVICE_ADMIN && !deviceAdmin) add("device admin")
        if (!accessibility) add("accessibility service")
        if (method == FilterMethod.PRIVATE_DNS) {
            if (dnsIssue != null) add("DNS filter (Private DNS)")
        } else {
            if (!vpn) add("DNS filter (VPN)")
            if (!privateDnsOk) add("private DNS points elsewhere")
        }
        if (!phoneRole) add("default phone app")
        if (!smsRole) add("default SMS app")
    }

    companion object {
        fun read(context: Context, filterHost: String?, needsUsageAccess: Boolean): Protections {
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            val roles = context.getSystemService(RoleManager::class.java)
            val usageAccessGranted = TimeGuard.hasUsageAccess(context)
            return Protections(
                deviceOwner = dpm?.isDeviceOwnerApp(context.packageName) == true,
                // The Play edition declares no admin receiver, so it does not ask Android about one.
                deviceAdmin = Distribution.DEVICE_ADMIN && (dpm?.isAdminActive(LightAdminReceiver.component(context)) == true ||
                    dpm?.isDeviceOwnerApp(context.packageName) == true),
                accessibility = isGuardEnabled(context),
                usageAccess = !needsUsageAccess || usageAccessGranted,
                usageAccessGranted = usageAccessGranted,
                vpn = PlainphoneVpnService.isRunning(),
                alwaysOnVpn = PlainphoneVpnService.isAlwaysOn(context),
                phoneRole = roles?.isRoleHeld(RoleManager.ROLE_DIALER) == true,
                smsRole = roles?.isRoleHeld(RoleManager.ROLE_SMS) == true,
                notifications = context.getSystemService(NotificationManager::class.java)?.areNotificationsEnabled() == true,
                batteryUnrestricted = context.getSystemService(PowerManager::class.java)
                    ?.isIgnoringBatteryOptimizations(context.packageName) == true,
                privateDnsOk = if (Mode.isLight(context)) {
                    LightFilter.vpnPrivateDnsOk(
                        Settings.Global.getString(context.contentResolver, "private_dns_mode"),
                        privateDnsServer(context),
                    )
                } else privateDnsOk(privateDnsServer(context), filterHost),
            )
        }

        /** Strong mode expects its own strict Private DNS hostname. */
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
