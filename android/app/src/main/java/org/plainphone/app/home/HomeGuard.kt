// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import android.provider.Settings
import org.plainphone.app.PlainphoneAdminReceiver

/**
 * Keeps a broken home screen from locking the phone up. A persistent preferred HOME survives
 * Android's own "this launcher keeps crashing" fallback, and adb is blocked, so Plainphone guards
 * itself: if the home screen fails to draw [MAX_FAILED_STARTS] times in a row, it is let go and the
 * maker's launcher takes over until the next app update. The lock step then reports it as failed,
 * so the parent sees it in the dashboard.
 */
object HomeGuard {
    const val MAX_FAILED_STARTS = 3
    private const val PREFS = "plainphone_home"

    /**
     * Called first thing in HomeActivity.onCreate. False when the home screen failed to draw
     * [MAX_FAILED_STARTS] times in a row: it lets go right here (unpins HOME and switches itself
     * off), so Android falls back to the maker's launcher at once instead of relaunching a broken
     * home screen until the next policy run. The caller must finish without drawing.
     */
    @SuppressLint("ApplySharedPref") // Must be on disk before a crash in the same start can lose it.
    fun starting(context: Context): Boolean {
        val p = prefs(context)
        val failed = p.getInt("starts", 0)
        if (failed >= MAX_FAILED_STARTS) {
            letGo(context)
            return false
        }
        p.edit().putInt("starts", failed + 1).commit()
        return true
    }

    /**
     * Called when the app process starts. A new version gets a fresh chance: the count is reset
     * and the home screen switched back on, so the next policy run may pin it again.
     */
    fun onAppStart(context: Context) {
        val p = prefs(context)
        val version = versionCode(context)
        if (p.getLong("version", -1L) == version) return
        p.edit().putLong("version", version).putInt("starts", 0).apply()
        setEnabled(context, true)
    }

    private fun letGo(context: Context) {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        if (dpm?.isDeviceOwnerApp(context.packageName) == true) {
            runCatching { dpm.clearPackagePersistentPreferredActivities(PlainphoneAdminReceiver.component(context), context.packageName) }
        }
        // Also covers light mode, where the child picked Plainphone as the home app.
        setEnabled(context, false)
    }

    /** False after [starting] let go, until the next app update. */
    fun isEnabled(context: Context): Boolean =
        context.packageManager.getComponentEnabledSetting(ComponentName(context, HomeActivity::class.java)) !=
            PackageManager.COMPONENT_ENABLED_STATE_DISABLED

    private fun setEnabled(context: Context, enabled: Boolean) {
        runCatching {
            context.packageManager.setComponentEnabledSetting(
                ComponentName(context, HomeActivity::class.java),
                if (enabled) PackageManager.COMPONENT_ENABLED_STATE_DEFAULT else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
                PackageManager.DONT_KILL_APP,
            )
        }
    }

    private fun versionCode(context: Context): Long =
        runCatching { context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode }.getOrDefault(0L)

    /** Called once the first frame is on screen. */
    fun drawn(context: Context) {
        prefs(context).edit().putInt("starts", 0).apply()
    }

    /** Null when the home screen may be pinned, else why not. */
    fun blockReason(context: Context): String? {
        // During the setup wizard the wizard must stay the home screen.
        val setupDone = runCatching { Settings.Secure.getInt(context.contentResolver, USER_SETUP_COMPLETE, 1) }.getOrDefault(1) == 1
        if (!setupDone) return "waiting for setup to finish"
        onAppStart(context)
        val failed = prefs(context).getInt("starts", 0) >= MAX_FAILED_STARTS || !isEnabled(context)
        return if (failed) "home screen failed to start $MAX_FAILED_STARTS times; the maker's launcher is used" else null
    }

    /** Settings.Secure.USER_SETUP_COMPLETE is hidden in the SDK. */
    private const val USER_SETUP_COMPLETE = "user_setup_complete"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
