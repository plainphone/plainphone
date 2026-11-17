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
import org.plainphone.app.sync.SyncStore

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

    private val stateLock = Any()

    internal data class Active(val packageName: String, val accountsAllowed: Boolean)

    internal fun active(context: Context, nowMs: Long = System.currentTimeMillis()): Active? {
        val state = prefs(context).all
        val pkg = state["pkg"] as? String ?: return null
        val until = state["until"] as? Long ?: return null
        if (until <= nowMs || isInstalled(context, pkg)) return null
        return Active(pkg, state["accountsAllowed"] == true)
    }

    fun current(context: Context, nowMs: Long = System.currentTimeMillis()): String? =
        active(context, nowMs)?.packageName

    /** Opens Play for this app. Call off the main thread. */
    fun open(context: Context, packageName: String) = open(context, packageName, accountsAllowed = false)

    /** Only called after the parent PIN has been verified. */
    internal fun openForParent(context: Context, packageName: String) =
        open(context, packageName, accountsAllowed = true)

    private fun open(context: Context, packageName: String, accountsAllowed: Boolean) {
        val app = context.applicationContext
        if (SyncStore(app).rules()?.toInstall?.none { it.packageName == packageName } != false) return
        if (isInstalled(app, packageName)) return

        val changed = synchronized(stateLock) {
            val window = active(app)
            val p = prefs(app)
            if (window?.packageName == packageName) {
                if (!accountsAllowed || window.accountsAllowed) return@synchronized false
                p.edit().putBoolean("accountsAllowed", true).apply()
            } else {
                if (!takeWindow(app)) return@synchronized false
                p.edit().putString("pkg", packageName)
                    .putLong("until", System.currentTimeMillis() + WINDOW_MS)
                    .putBoolean("accountsAllowed", accountsAllowed)
                    .apply()
                scheduleClose(app)
            }
            true
        }
        if (changed) runCatching { Lock.applyNow(app, "install window for $packageName") }
        launchPlay(app, packageName)
    }

    const val MAX_PER_DAY = 5

    private fun takeWindow(context: Context): Boolean {
        val day = java.time.LocalDate.now().toString()
        val p = prefs(context)
        val used = if (p.getString("day", null) == day) p.getInt("windows", 0) else 0
        if (used >= MAX_PER_DAY) return false
        p.edit().putString("day", day).putInt("windows", used + 1).apply()
        return true
    }

    /** Ends the window (app installed or time up) and puts the lock back. */
    fun close(context: Context, reason: String) {
        val app = context.applicationContext
        synchronized(stateLock) {
            if (prefs(app).getString("pkg", null) == null) return
            prefs(app).edit().remove("pkg").remove("until").remove("accountsAllowed").apply()
        }
        Lock.applyAsync(app, reason)
    }

    /** Called for every package added while the app runs. */
    fun onPackageAdded(context: Context, packageName: String) {
        val open = prefs(context).getString("pkg", null)
        when {
            packageName == open -> close(context, "installed $packageName")
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
