// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.catalog

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import org.plainphone.app.Lock
import org.plainphone.app.PolicyConfig
import org.plainphone.app.RelockReceiver
import org.plainphone.app.light.Mode

/**
 * Installing an app the parent picked from the catalog (R2, docs/app-catalog.md).
 *
 * Strong mode: installs are blocked and Play is hidden. For one approved app Plainphone opens a
 * short window: the install restriction is lifted, Play is shown and opened on that app's page.
 * The window closes as soon as the app is installed, or after [WINDOW_MS]. Anything else the child
 * installs meanwhile is unknown to the parent and therefore hidden at once.
 *
 * Light mode: nothing is locked, so it just opens the app's Play page.
 */
object InstallWindow {
    const val WINDOW_MS = 15 * 60_000L
    private const val PREFS = "plainphone_install"

    /** The package whose install window is open right now, or null. */
    fun current(context: Context, nowMs: Long = System.currentTimeMillis()): String? {
        val p = prefs(context)
        val pkg = p.getString("pkg", null) ?: return null
        return pkg.takeIf { p.getLong("until", 0L) > nowMs && !isInstalled(context, pkg) }
    }

    /** Opens Play for [packageName]. Blocking in strong mode (applies the lock): call off the main thread. */
    fun open(context: Context, packageName: String) {
        val app = context.applicationContext
        if (Mode.isStrong(app)) {
            prefs(app).edit().putString("pkg", packageName).putLong("until", System.currentTimeMillis() + WINDOW_MS).apply()
            scheduleClose(app)
            Lock.applyNow(app, "install window for $packageName")
        }
        launchPlay(app, packageName)
    }

    /** Ends the window (app installed or time up) and puts the lock back. */
    fun close(context: Context, reason: String) {
        val app = context.applicationContext
        if (prefs(app).getString("pkg", null) == null) return
        prefs(app).edit().clear().apply()
        Lock.applyAsync(app, reason)
    }

    /** Called for every package added while the app runs. */
    fun onPackageAdded(context: Context, packageName: String) {
        val open = prefs(context).getString("pkg", null) ?: return
        if (packageName == open) close(context, "installed $packageName") else Lock.applyAsync(context, "app installed during install window")
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

    private fun scheduleClose(context: Context) {
        val intent = PendingIntent.getBroadcast(
            context,
            2,
            Intent(context, RelockReceiver::class.java).setAction(RelockReceiver.ACTION_INSTALL_DONE),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        context.getSystemService(AlarmManager::class.java)
            .setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, System.currentTimeMillis() + WINDOW_MS + 1_000L, intent)
    }

    private fun isInstalled(context: Context, pkg: String) =
        runCatching { context.packageManager.getPackageInfo(pkg, 0) }.isSuccess

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
