// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.catalog

import android.accounts.AccountManager
import android.app.AlarmManager
import android.app.PendingIntent
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import java.security.MessageDigest
import java.util.Base64
import org.plainphone.app.Lock
import org.plainphone.app.PolicyConfig
import org.plainphone.app.RelockReceiver
import org.plainphone.app.light.Mode
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
    private const val GOOGLE = "com.google"
    private const val PREFS = "plainphone_install"
    private const val ACCOUNT_BASELINE = "googleAccountFingerprints"

    private val stateLock = Any()

    internal data class Active(val packageName: String, val accountsAllowed: Boolean)

    internal fun active(context: Context, nowMs: Long = System.currentTimeMillis()): Active? {
        return synchronized(stateLock) {
            val p = prefs(context)
            val pkg = p.getString("pkg", null) ?: return null
            if (p.getLong("until", 0L) <= nowMs || isInstalled(context, pkg)) return null
            val baseline = p.getStringSet(ACCOUNT_BASELINE, null)
            val accountsAllowed = p.getBoolean("accountsAllowed", false) &&
                baseline != null && baseline.containsAll(googleAccountFingerprints(context))
            Active(pkg, accountsAllowed)
        }
    }

    fun current(context: Context, nowMs: Long = System.currentTimeMillis()): String? =
        active(context, nowMs)?.packageName

    /** Opens Play for this app. Call off the main thread. */
    fun open(context: Context, packageName: String) {
        open(context, packageName, accountsAllowed = false)
    }

    /** Only called after the parent PIN has been verified. */
    internal fun openForParent(context: Context, packageName: String) =
        open(context, packageName, accountsAllowed = true)

    internal enum class OpenResult { OPENED, UNAVAILABLE, DAILY_LIMIT }

    private fun open(context: Context, packageName: String, accountsAllowed: Boolean): OpenResult {
        val app = context.applicationContext
        if (SyncStore(app).rules()?.toInstall?.none { it.packageName == packageName } != false) return OpenResult.UNAVAILABLE
        if (isInstalled(app, packageName)) return OpenResult.UNAVAILABLE

        val changed = synchronized(stateLock) {
            val allowAccounts = accountsAllowed && Mode.isStrong(app)
            val window = active(app)
            val p = prefs(app)
            if (window?.packageName == packageName) {
                if (!allowAccounts || window.accountsAllowed) return@synchronized false
                p.edit().putBoolean("accountsAllowed", true)
                    .putStringSet(ACCOUNT_BASELINE, googleAccountFingerprints(app)).remove("googleAccounts").apply()
            } else {
                if (!takeWindow(app)) return OpenResult.DAILY_LIMIT
                p.edit().putString("pkg", packageName)
                    .putLong("until", System.currentTimeMillis() + WINDOW_MS)
                    .putBoolean("accountsAllowed", allowAccounts)
                    .putStringSet(ACCOUNT_BASELINE, if (allowAccounts) googleAccountFingerprints(app) else null)
                    .remove("googleAccounts")
                    .apply()
                scheduleClose(app)
            }
            true
        }
        if (changed) runCatching { Lock.applyNow(app, "install window for $packageName") }
        launchPlay(app, packageName)
        return OpenResult.OPENED
    }

    /** Reapply the account restriction as soon as Android reports a Google account change. */
    fun watchAccounts(context: Context) {
        val app = context.applicationContext
        AccountManager.get(app).addOnAccountsUpdatedListener(
            {
                val closed = synchronized(stateLock) { updateAccountWindow(app) }
                if (closed) Lock.applyIfNeededAsync(app, "Google account added during install") {}
            },
            null,
            true,
            arrayOf(GOOGLE),
        )
    }

    private fun updateAccountWindow(context: Context): Boolean {
        val p = prefs(context)
        if (!p.getBoolean("accountsAllowed", false)) return false
        val current = googleAccountFingerprints(context)
        val baseline = p.getStringSet(ACCOUNT_BASELINE, null)
        if (baseline == null || !baseline.containsAll(current)) {
            p.edit().putBoolean("accountsAllowed", false).remove(ACCOUNT_BASELINE).remove("googleAccounts").apply()
            return true
        }
        if (current != baseline) p.edit().putStringSet(ACCOUNT_BASELINE, current).apply()
        return false
    }

    private fun googleAccountFingerprints(context: Context): Set<String> {
        val hash = MessageDigest.getInstance("SHA-256")
        val encode = Base64.getEncoder()
        return AccountManager.get(context).getAccountsByType(GOOGLE).mapTo(mutableSetOf()) {
            encode.encodeToString(hash.digest(it.name.toByteArray()))
        }
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
            prefs(app).edit().remove("pkg").remove("until").remove("accountsAllowed")
                .remove(ACCOUNT_BASELINE).remove("googleAccounts").apply()
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
