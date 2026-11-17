// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.annotation.SuppressLint
import android.os.UserManager

/**
 * The pure part of the lock: which restrictions to set and which apps to hide.
 * No Android services are touched here, so it is unit-tested on the JVM.
 */
object LockPolicy {
    /** UserManager.DISALLOW_ADD_CLONE_PROFILE (API 34), not exposed in the public SDK. */
    const val DISALLOW_ADD_CLONE_PROFILE = "no_add_clone_profile"


    /** User restrictions for strong mode, filtered to what [sdkInt] knows about. */
    @SuppressLint("InlinedApi") // API 34/35 constants are plain strings and only added when sdkInt is high enough.
    @Suppress("DEPRECATION") // DISALLOW_ADD_MANAGED_PROFILE is deprecated in API 37 but still enforced.
    fun restrictions(sdkInt: Int): List<String> = buildList {
        // Installing and removing software.
        add(UserManager.DISALLOW_INSTALL_APPS)
        add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES)
        add(UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY)
        // Ways out: reset, safe mode, other users and profiles.
        add(UserManager.DISALLOW_FACTORY_RESET)
        add(UserManager.DISALLOW_SAFE_BOOT)
        add(UserManager.DISALLOW_ADD_USER)
        add(UserManager.DISALLOW_USER_SWITCH)
        add(UserManager.DISALLOW_ADD_MANAGED_PROFILE)
        // App cloning (Samsung Dual Messenger, Xiaomi Dual apps). The constant is hidden in the SDK.
        if (sdkInt >= 34) add(DISALLOW_ADD_CLONE_PROFILE)
        if (sdkInt >= 35) add(UserManager.DISALLOW_ADD_PRIVATE_PROFILE)
        // adb and developer options.
        add(UserManager.DISALLOW_DEBUGGING_FEATURES)
        // Network filter: private DNS, VPN apps, network reset, user CA certificates.
        add(UserManager.DISALLOW_CONFIG_PRIVATE_DNS)
        add(UserManager.DISALLOW_CONFIG_VPN)
        add(UserManager.DISALLOW_NETWORK_RESET)
        add(UserManager.DISALLOW_CONFIG_CREDENTIALS)
        // Getting APKs onto the phone over USB or an SD card.
        add(UserManager.DISALLOW_USB_FILE_TRANSFER)
        add(UserManager.DISALLOW_MOUNT_PHYSICAL_MEDIA)
        // Date/time tricks against schedules (phase 3) and certificate checks.
        add(UserManager.DISALLOW_CONFIG_DATE_TIME)
        // Phase 2: the default phone and SMS app (Plainphone) cannot be changed in Settings (Android 14+).
        // Older phones: the maker's extra dialers and SMS apps are hidden, but the system dialer is not (emergency
        // fallback) and can be picked in Settings. Calls are then unfiltered until the role is back; the switch
        // shows up as a failed "default phone app" step in the parent's status.
        if (sdkInt >= 34) add(UserManager.DISALLOW_CONFIG_DEFAULT_APPS)
        // #21: no account the child controls (Google or the maker's) can become the FRP or "find and erase" owner.
        // A maintenance unlock lifts it, so a parent can add the Google account Play needs.
        add(UserManager.DISALLOW_MODIFY_ACCOUNTS)
        // #26: screen content is not handed to assistants (Circle to Search, Lens) or suggestion services.
        add(UserManager.DISALLOW_CONTENT_CAPTURE)
        add(UserManager.DISALLOW_CONTENT_SUGGESTIONS)
        if (sdkInt >= 35) add(UserManager.DISALLOW_ASSIST_CONTENT)
    }

    /**
     * Decides which launchable apps are hidden.
     *
     * @param launchable packages that currently have a launcher icon, including ones we hid earlier
     * @param keep packages that must stay visible (core apps resolved on the device, allowlist, ourselves)
     * @param previouslyHidden packages we hid in an earlier run
     */
    fun hidePlan(
        launchable: Set<String>,
        keep: Set<String>,
        previouslyHidden: Set<String>,
    ): HidePlan {
        val shouldBeHidden = launchable - keep
        return HidePlan(
            hide = shouldBeHidden,
            // Apps we hid before that are now allowed, or that we no longer see at all.
            unhide = previouslyHidden - shouldBeHidden,
        )
    }

    data class HidePlan(val hide: Set<String>, val unhide: Set<String>)

    /**
     * The maker's phone and SMS apps to hide once Plainphone holds the role (below Android 14
     * the extra dialers always), so approved contacts cannot be bypassed through them.
     *
     * The system dialer is never hidden: Android falls back to it for
     * emergency calls if the default phone app fails, and lock-screen
     * emergency calls depend on the telephony stack it ships with. Calls
     * started from it still pass through Plainphone's call service, which
     * ends calls to numbers that are not approved.
     */
    fun telephonyAppsToHide(
        apps: TelephonyApps,
        ownPackage: String,
        holdsDialer: Boolean,
        holdsSms: Boolean,
        sdkInt: Int = 34,
    ): Set<String> {
        val hide = mutableSetOf<String>()
        // Without a known system dialer we cannot tell which one Android falls back to: hide none.
        // Android 10 to 13 cannot lock the default apps, so the extra dialers stay hidden even when the
        // phone role was moved away from Plainphone: then only the system dialer can be picked in Settings.
        if ((holdsDialer || sdkInt < 34) && apps.systemDialer != null) hide += apps.dialers
        if (holdsSms) hide += apps.smsApps
        hide -= ownPackage
        apps.systemDialer?.let { hide -= it }
        // Never hide the app that holds the phone role right now: Android would have no phone app.
        apps.defaultDialer?.let { hide -= it }
        return hide
    }

    /**
     * Runtime permissions the phone and SMS app needs on [sdkInt]. The roles grant most of them;
     * Device Owner makes sure. POST_NOTIFICATIONS only exists (and can only be granted) from Android 13.
     */
    @SuppressLint("InlinedApi") // POST_NOTIFICATIONS is a plain string and dropped below API 33.
    fun telephonyPermissions(sdkInt: Int): List<String> =
        if (sdkInt >= 33) TELEPHONY_PERMISSIONS else TELEPHONY_PERMISSIONS - android.Manifest.permission.POST_NOTIFICATIONS

    @SuppressLint("InlinedApi") // Filtered by telephonyPermissions().
    private val TELEPHONY_PERMISSIONS = listOf(
        android.Manifest.permission.CALL_PHONE,
        android.Manifest.permission.READ_PHONE_STATE,
        android.Manifest.permission.ANSWER_PHONE_CALLS,
        android.Manifest.permission.READ_CALL_LOG,
        android.Manifest.permission.WRITE_CALL_LOG,
        android.Manifest.permission.SEND_SMS,
        android.Manifest.permission.RECEIVE_SMS,
        android.Manifest.permission.READ_SMS,
        android.Manifest.permission.RECEIVE_MMS,
        android.Manifest.permission.RECEIVE_WAP_PUSH,
        android.Manifest.permission.POST_NOTIFICATIONS,
    )

    /** Only set while the parent has location on, so the child cannot switch it off. */
    const val LOCATION_RESTRICTION = UserManager.DISALLOW_CONFIG_LOCATION

    /** Granted by Device Owner when the parent turns location on; background so "Find" works from a worker. */
    val LOCATION_PERMISSIONS = listOf(
        android.Manifest.permission.ACCESS_FINE_LOCATION,
        android.Manifest.permission.ACCESS_COARSE_LOCATION,
        android.Manifest.permission.ACCESS_BACKGROUND_LOCATION,
    )

    /** Chrome managed configuration: no DNS-over-HTTPS bypass, no incognito, SafeSearch on. */
    const val CHROME_PACKAGE = "com.android.chrome"
    val chromeRestrictions: Map<String, Any> = mapOf(
        "DnsOverHttpsMode" to "off",
        "IncognitoModeAvailability" to 1,
        "ForceGoogleSafeSearch" to true,
        "ForceYouTubeRestrict" to 2,
    )
}
