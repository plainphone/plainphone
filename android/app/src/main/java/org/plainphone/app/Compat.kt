// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.ResolveInfo
import android.os.Build
import android.os.Parcelable

/**
 * Version switches for platform calls whose modern form needs a newer Android than the
 * app's minSdk (29, Android 10). Each helper uses the modern API where it exists and the
 * older, deprecated form with the same meaning below it. See docs/android-versions.md.
 */
internal object Compat {
    fun queryActivities(pm: PackageManager, intent: Intent, flags: Int): List<ResolveInfo> =
        if (Build.VERSION.SDK_INT >= 33) {
            pm.queryIntentActivities(intent, PackageManager.ResolveInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION") // The int overload is the only one before Android 13.
            pm.queryIntentActivities(intent, flags)
        }

    fun queryServices(pm: PackageManager, intent: Intent, flags: Int): List<ResolveInfo> =
        if (Build.VERSION.SDK_INT >= 33) {
            pm.queryIntentServices(intent, PackageManager.ResolveInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.queryIntentServices(intent, flags)
        }

    fun queryReceivers(pm: PackageManager, intent: Intent, flags: Int): List<ResolveInfo> =
        if (Build.VERSION.SDK_INT >= 33) {
            pm.queryBroadcastReceivers(intent, PackageManager.ResolveInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.queryBroadcastReceivers(intent, flags)
        }

    fun packageInfo(pm: PackageManager, pkg: String, flags: Int): PackageInfo =
        if (Build.VERSION.SDK_INT >= 33) {
            pm.getPackageInfo(pkg, PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.getPackageInfo(pkg, flags)
        }

    fun applicationInfo(pm: PackageManager, pkg: String, flags: Int): ApplicationInfo =
        if (Build.VERSION.SDK_INT >= 33) {
            pm.getApplicationInfo(pkg, PackageManager.ApplicationInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.getApplicationInfo(pkg, flags)
        }

    inline fun <reified T : Parcelable> parcelableExtra(intent: Intent, name: String): T? =
        if (Build.VERSION.SDK_INT >= 33) {
            intent.getParcelableExtra(name, T::class.java)
        } else {
            @Suppress("DEPRECATION") // The typed overload arrived in Android 13.
            intent.getParcelableExtra(name) as? T
        }
}
