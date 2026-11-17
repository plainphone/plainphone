// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.catalog

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import org.plainphone.app.Lock
import org.plainphone.app.PolicyConfig
import org.plainphone.app.update.InstallLease

/**
 * Installing an app the parent picked from the catalog (R2, docs/app-catalog.md).
 *
 * Strong mode: installs are blocked and Play is hidden. For one approved app Plainphone opens a
 * short window: the install restriction is lifted, Play is shown and opened on that app's page.
 * The window closes as soon as the app is installed, or after [WINDOW_MS]. Anything else the child
 * installs meanwhile is unknown to the parent and therefore hidden at once.
 *
 * Light mode: Play is one of the apps the guard closes, so the same window lets it through for
 * that time.
 */
object InstallWindow {
    const val WINDOW_MS = 15 * 60_000L
    private const val PREFS = "plainphone_install"

    /** The package whose install window is open right now, or null. */
    fun current(context: Context, nowMs: Long = System.currentTimeMillis()): String? {
        val p = prefs(context)
        val pkg = p.getString("pkg", null) ?: return null
        if (!InstallLease.android(context).isOpen(InstallLease.CATALOG)) return null
        return pkg.takeIf { p.getLong("until", 0L) > nowMs && !isInstalled(context, pkg) }
    }

    /** Opens Play for [packageName]. Blocking in strong mode (applies the lock): call off the main thread. */
    @SuppressLint("ApplySharedPref")
    fun open(context: Context, packageName: String) {
        val app = context.applicationContext
        // Both modes: strong mode lifts the install restriction and shows Play, light mode's guard
        // lets Play through for the window instead of closing it.
        // Tapping again does not extend an open window, or Play could be kept open for good.
        // At most MAX_PER_DAY windows a day, so alternating between approved apps cannot keep Play open.
        synchronized(this) {
            if (isInstalled(app, packageName)) return
            if (current(app) != packageName) {
                val day = java.time.LocalDate.now().toString()
                val p = prefs(app)
                val previousDay = p.getString("day", null)
                val previousCount = p.getInt("windows", 0)
                val used = if (previousDay == day) previousCount else 0
                if (used >= MAX_PER_DAY) return

                val lease = InstallLease.android(app)
                try {
                    lease.begin(InstallLease.CATALOG, WINDOW_MS)
                } catch (e: Exception) {
                    Log.w("Plainphone", "could not open catalog install window", e)
                    return
                }
                try {
                    check(p.edit().putString("pkg", packageName)
                        .putLong("until", System.currentTimeMillis() + WINDOW_MS)
                        .commit())
                    Lock.applyForInstall(app, "install window for $packageName", catalogChanged = true)
                    if (current(app) != packageName) {
                        close(app, "catalog target is no longer eligible", packageName)
                        return
                    }
                    if (!p.edit().putString("day", day).putInt("windows", used + 1).commit()) {
                        p.edit().putString("day", previousDay).putInt("windows", previousCount).apply()
                        error("Could not save the catalog quota")
                    }
                } catch (e: Exception) {
                    Log.w("Plainphone", "catalog install window failed", e)
                    close(app, "catalog install window failed", packageName)
                    return
                }
            }
        }
        launchPlay(app, packageName)
    }

    const val MAX_PER_DAY = 5

    /** Ends the window (app installed or time up) and puts the lock back. */
    @Synchronized
    fun close(context: Context, reason: String, expectedPackage: String? = null) {
        val app = context.applicationContext
        val openPackage = prefs(app).getString("pkg", null) ?: return
        if (expectedPackage != null && openPackage != expectedPackage) return
        prefs(app).edit().remove("pkg").remove("until").apply()
        try {
            InstallLease.android(app).invalidate(InstallLease.CATALOG)
        } finally {
            Lock.recoverInstallAsync(app, reason)
        }
    }

    /** Called for every package added while the app runs. */
    fun onPackageAdded(context: Context, packageName: String) {
        val open = prefs(context).getString("pkg", null)
        when {
            packageName == open -> close(context, "installed $packageName", packageName)
            open != null -> Lock.applyAsync(context, "app installed during install window")
            // Light mode cannot stop installs: put the new app on the guard's list straight away.
            org.plainphone.app.light.Mode.isLight(context) && !Lock.isInMaintenanceWindow(context) ->
                Lock.applyAsync(context, "app installed")
        }
    }

    fun playIntent(packageName: String): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("market://details?id=$packageName")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun webIntent(packageName: String): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse("https://play.google.com/store/apps/details?id=$packageName"))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun launchPlay(context: Context, packageName: String) {
        val play = playIntent(packageName).setPackage(PolicyConfig.PLAY_STORE)
        try {
            context.startActivity(play)
        } catch (_: ActivityNotFoundException) {
            // No Play Store (a phone without Google): the web page at least says what the app is.
            runCatching { context.startActivity(webIntent(packageName)) }
        }
    }

    private fun isInstalled(context: Context, pkg: String) =
        runCatching { context.packageManager.getPackageInfo(pkg, 0) }.isSuccess

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
