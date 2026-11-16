// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.app.admin.FactoryResetProtectionPolicy
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.AlarmClock
import android.provider.ContactsContract
import android.provider.MediaStore
import android.provider.Settings
import android.provider.Telephony
import android.telecom.InCallService
import android.telecom.TelecomManager
import android.view.inputmethod.InputMethodManager

/** The device-facing side of the lock. Faked in unit tests. */
interface DeviceControls {
    val ownPackage: String
    fun isDeviceOwner(): Boolean
    fun addRestriction(key: String)
    fun clearRestriction(key: String)
    fun launchablePackages(): Set<String>
    fun corePackages(): Set<String>
    fun isInstalled(pkg: String): Boolean
    fun setHidden(pkg: String, hidden: Boolean): Boolean
    fun isHidden(pkg: String): Boolean
    /** Returns a human-readable result; throws if the call is impossible. */
    fun forcePrivateDns(host: String): String
    fun releasePrivateDns()
    fun setAppRestrictions(pkg: String, values: Map<String, Any>?)
    fun setFrpAccounts(accountIds: Set<String>?)
    fun setUninstallBlocked(pkg: String, blocked: Boolean)
    fun requireAutoTime(required: Boolean)
    fun clearDeviceOwner()

    // Phase 2: phone and SMS roles.
    fun holdsRole(role: String): Boolean
    /** Makes [pkg] the default phone app (Device Owner, API 34+). Throws if Android refuses. */
    fun setDefaultDialer(pkg: String)
    /** Makes [pkg] the default SMS app (Device Owner). Throws if Android refuses. */
    fun setDefaultSms(pkg: String)
    /** Installed apps that can dial, can send SMS, and the system dialer that handles emergency fallback. */
    fun telephonyApps(): TelephonyApps
    /** Grants a runtime permission to [pkg]; returns false if Android refused. */
    fun grantPermission(pkg: String, permission: String): Boolean

    // Phase 4: location for "Find".
    fun setLocationEnabled(enabled: Boolean)
}

data class TelephonyApps(
    /** Apps that can be the phone app: open the dial screen and have an in-call service. */
    val dialers: Set<String>,
    /** Apps that can be the SMS app: receive SMS_DELIVER. Messengers that only open `smsto:` links are not in here. */
    val smsApps: Set<String>,
    /** TelecomManager.getSystemDialerPackage(): never hidden, Android falls back to it for emergency calls. */
    val systemDialer: String?,
    /** SMS apps that came with the phone; preferred when the SMS role is given back. */
    val systemSmsApps: Set<String> = emptySet(),
)

class AndroidDeviceControls(private val context: Context) : DeviceControls {
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val pm = context.packageManager
    private val admin = PlainphoneAdminReceiver.component(context)

    override val ownPackage: String = context.packageName

    override fun isDeviceOwner() = dpm.isDeviceOwnerApp(context.packageName)

    override fun addRestriction(key: String) = dpm.addUserRestriction(admin, key)

    override fun clearRestriction(key: String) = dpm.clearUserRestriction(admin, key)


    override fun launchablePackages(): Set<String> {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        return pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(0))
            .map { it.activityInfo.packageName }
            .toSet()
    }

    /**
     * The apps a calm phone needs, resolved per device so Samsung, Xiaomi and
     * Pixel all keep their own dialer, messages, camera and clock.
     */
    override fun corePackages(): Set<String> {
        val intents = listOf(
            Intent(Intent.ACTION_DIAL),
            Intent(MediaStore.ACTION_IMAGE_CAPTURE),
            Intent(MediaStore.INTENT_ACTION_STILL_IMAGE_CAMERA),
            Intent(AlarmClock.ACTION_SHOW_ALARMS),
            Intent(Intent.ACTION_VIEW, ContactsContract.Contacts.CONTENT_URI),
            Intent(Settings.ACTION_SETTINGS),
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
        )
        val found = mutableSetOf<String>()
        for (intent in intents) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong()))
                .mapTo(found) { it.activityInfo.packageName }
        }
        // Messages: apps that can really be the SMS app (the default may not be set yet during setup).
        // Not every `smsto:` handler, which would keep WhatsApp and other messengers visible.
        found += smsDeliverReceivers()
        Telephony.Sms.getDefaultSmsPackage(context)?.let(found::add)
        context.getSystemService(InputMethodManager::class.java)
            ?.enabledInputMethodList
            ?.mapTo(found) { it.packageName }
        return found
    }

    override fun isInstalled(pkg: String): Boolean = runCatching {
        pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(PackageManager.MATCH_UNINSTALLED_PACKAGES.toLong()))
    }.isSuccess

    override fun setHidden(pkg: String, hidden: Boolean): Boolean =
        dpm.setApplicationHidden(admin, pkg, hidden)

    override fun isHidden(pkg: String): Boolean = dpm.isApplicationHidden(admin, pkg)

    override fun forcePrivateDns(host: String): String {
        // Does a network check against the host, so never call this on the main thread.
        return when (val result = dpm.setGlobalPrivateDnsModeSpecifiedHost(admin, host)) {
            DevicePolicyManager.PRIVATE_DNS_SET_NO_ERROR -> "private DNS forced to $host"
            DevicePolicyManager.PRIVATE_DNS_SET_ERROR_HOST_NOT_SERVING ->
                throw IllegalStateException("$host does not answer DNS-over-TLS (no network?)")
            else -> throw IllegalStateException("setGlobalPrivateDnsModeSpecifiedHost failed: $result")
        }
    }

    override fun releasePrivateDns() {
        dpm.setGlobalPrivateDnsModeOpportunistic(admin)
    }

    override fun setAppRestrictions(pkg: String, values: Map<String, Any>?) {
        val bundle = Bundle()
        values?.forEach { (k, v) ->
            when (v) {
                is String -> bundle.putString(k, v)
                is Int -> bundle.putInt(k, v)
                is Boolean -> bundle.putBoolean(k, v)
                else -> error("unsupported restriction value for $k")
            }
        }
        dpm.setApplicationRestrictions(admin, pkg, bundle)
    }

    override fun setFrpAccounts(accountIds: Set<String>?) {
        val policy = accountIds?.let {
            FactoryResetProtectionPolicy.Builder()
                .setFactoryResetProtectionAccounts(it.toList())
                .setFactoryResetProtectionEnabled(true)
                .build()
        }
        // Throws UnsupportedOperationException on devices without FRP support.
        dpm.setFactoryResetProtectionPolicy(admin, policy)
    }

    override fun setUninstallBlocked(pkg: String, blocked: Boolean) =
        dpm.setUninstallBlocked(admin, pkg, blocked)

    override fun requireAutoTime(required: Boolean) {
        dpm.setAutoTimeEnabled(admin, required)
        dpm.setAutoTimeZoneEnabled(admin, required)
    }

    @Suppress("DEPRECATION") // The documented way for a DPC to give up Device Owner on a test device.
    override fun clearDeviceOwner() = dpm.clearDeviceOwnerApp(context.packageName)

    override fun holdsRole(role: String): Boolean =
        context.getSystemService(RoleManager::class.java)?.isRoleHeld(role) == true

    override fun setDefaultDialer(pkg: String) = dpm.setDefaultDialerApplication(pkg)

    override fun setDefaultSms(pkg: String) = dpm.setDefaultSmsApplication(admin, pkg)

    override fun telephonyApps(): TelephonyApps {
        val flags = PackageManager.ResolveInfoFlags.of(PackageManager.MATCH_DEFAULT_ONLY.toLong())
        val dialScreens = (pm.queryIntentActivities(Intent(Intent.ACTION_DIAL), flags) +
            pm.queryIntentActivities(Intent(Intent.ACTION_DIAL, Uri.parse("tel:1")), flags))
            .map { it.activityInfo.packageName }.toSet()
        val inCall = pm.queryIntentServices(Intent(InCallService.SERVICE_INTERFACE), PackageManager.ResolveInfoFlags.of(0))
            .map { it.serviceInfo.packageName }.toSet()
        val smsReceivers = smsDeliverReceivers() + listOfNotNull(Telephony.Sms.getDefaultSmsPackage(context))
        return TelephonyApps(
            dialers = dialScreens intersect inCall,
            smsApps = smsReceivers,
            systemDialer = context.getSystemService(TelecomManager::class.java)?.systemDialerPackage,
            systemSmsApps = smsReceivers.filter(::isSystemApp).toSet(),
        )
    }

    /** Packages that can be the default SMS app. Unlike `smsto:` handlers, this excludes WhatsApp and friends. */
    private fun smsDeliverReceivers(): Set<String> =
        pm.queryBroadcastReceivers(Intent(Telephony.Sms.Intents.SMS_DELIVER_ACTION), PackageManager.ResolveInfoFlags.of(0))
            .map { it.activityInfo.packageName }.toSet()

    private fun isSystemApp(pkg: String): Boolean = runCatching {
        (pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(0)).flags and ApplicationInfo.FLAG_SYSTEM) != 0
    }.getOrDefault(false)

    override fun grantPermission(pkg: String, permission: String): Boolean =
        dpm.setPermissionGrantState(admin, pkg, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED)

    override fun setLocationEnabled(enabled: Boolean) =
        dpm.setLocationEnabled(admin, enabled)
}
