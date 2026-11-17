// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings

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

    /** Called first thing in HomeActivity.onCreate. */
    @SuppressLint("ApplySharedPref") // Must be on disk before a crash in the same start can lose it.
    fun starting(context: Context) {
        val p = prefs(context)
        p.edit().putInt("starts", p.getInt("starts", 0) + 1).commit()
    }

    /** Called once the first frame is on screen. */
    fun drawn(context: Context) {
        prefs(context).edit().putInt("starts", 0).apply()
    }

    /** Null when the home screen may be pinned, else why not. */
    fun blockReason(context: Context): String? {
        // During the setup wizard the wizard must stay the home screen.
        val setupDone = runCatching { Settings.Secure.getInt(context.contentResolver, USER_SETUP_COMPLETE, 1) }.getOrDefault(1) == 1
        if (!setupDone) return "waiting for setup to finish"
        val p = prefs(context)
        val version = runCatching { context.packageManager.getPackageInfo(context.packageName, 0).longVersionCode }.getOrDefault(0L)
        if (p.getLong("version", -1L) != version) {
            // A new version gets a fresh chance.
            p.edit().putLong("version", version).putInt("starts", 0).apply()
            return null
        }
        return if (p.getInt("starts", 0) >= MAX_FAILED_STARTS) "home screen failed to start $MAX_FAILED_STARTS times; the maker's launcher is used" else null
    }

    /** Settings.Secure.USER_SETUP_COMPLETE is hidden in the SDK. */
    private const val USER_SETUP_COMPLETE = "user_setup_complete"

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
