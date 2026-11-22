// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.util.Log
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import java.util.concurrent.Executors
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.Lock
import org.plainphone.app.light.Mode
import org.plainphone.app.sync.AppUpdateRules
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

/**
 * Updates of approved apps in strong mode (issue #168, docs/policies.md "App updates").
 *
 * Strong mode keeps DISALLOW_INSTALL_APPS set and Play hidden, which also stops Play from
 * updating the apps the parents approved. Once a night (AppUpdateNight, AppUpdateWorker), or
 * when a parent presses "Update apps now", Plainphone opens a window of at most [WINDOW_MS]:
 * the restriction is lifted and Play is shown, through the same [InstallLease] as the catalog
 * window, so the watchdog, the expiry alarm and recovery after a crash or reboot put the
 * restriction back. Updates of installed apps go through; a new app that arrives meanwhile is
 * hidden at once and becomes a request for the parents.
 */
object AppUpdateWindow {
    const val WINDOW_MS = InstallLease.APP_UPDATES_MAX_MS
    /** A parent's "Update apps now" older than this is not acted on any more. */
    const val REQUEST_MAX_AGE_MS = 24 * 60 * 60_000L
    private const val TAG = "Plainphone"
    private const val PREFS = "plainphone_app_updates"

    enum class OpenResult { OPENED, ALREADY_OPEN, UNAVAILABLE, BATTERY_EXEMPTION_NEEDED, FAILED }

    fun isOpen(context: Context): Boolean =
        runCatching { InstallLease.android(context).isOpen(InstallLease.APP_UPDATES) }.getOrDefault(false)

    /** New apps caught by the guard that stay hidden until the server has made them a request. */
    fun heldBack(context: Context): Set<String> = prefs(context).getStringSet(HELD_BACK, null)?.toSet().orEmpty()

    /** Whether the parents' toggle "Update approved apps automatically" is on. Unpaired and old servers: on. */
    fun automatic(context: Context): Boolean = SyncStore(context).rules()?.appUpdates?.automatic ?: true

    internal fun log(context: Context) = AppUpdateLog(PrefsLogStore(context.applicationContext))

    /** Opens the window. Blocking (arms the watchdog, applies the lock): never call on the main thread. */
    @Synchronized
    fun open(context: Context, trigger: AppUpdateLog.Trigger): OpenResult {
        val app = context.applicationContext
        val sync = SyncStore(app)
        if (!Mode.isStrong(app) || !AndroidDeviceControls(app).isDeviceOwner() || Lock.isInMaintenanceWindow(app) ||
            sync.released || sync.releaseAsked || sync.setupUndoPending
        ) return OpenResult.UNAVAILABLE
        if (isOpen(app)) return OpenResult.ALREADY_OPEN
        val log = log(app)
        val id = UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        // Before the lease: packages that arrive while the policy applies are judged against this.
        log.opened(id, trigger, now, now + WINDOW_MS, installedPackages(app))
        val lease = InstallLease.android(app)
        return try {
            lease.begin(InstallLease.APP_UPDATES, WINDOW_MS)
            Lock.applyForAppUpdates(app, "app update window (${trigger.wire})")
            OpenResult.OPENED
        } catch (e: Exception) {
            Log.w(TAG, "app update window failed", e)
            val battery = e is BatteryExemptionMissingException
            log.failed(id, trigger, System.currentTimeMillis(), if (battery) "batteryExemption" else "failed")
            runCatching { closeLease(app, "app update window failed") }
                .onFailure { Log.w(TAG, "could not close failed app update window", it) }
            if (battery) OpenResult.BATTERY_EXEMPTION_NEEDED else OpenResult.FAILED
        }
    }

    /** Ends the window early and puts the lock back. */
    fun close(context: Context, reason: String) {
        val app = context.applicationContext
        log(app).closed(System.currentTimeMillis())
        closeLease(app, reason)
    }

    private fun closeLease(app: Context, reason: String) {
        try {
            InstallLease.android(app).invalidate(InstallLease.APP_UPDATES)
        } finally {
            Lock.recoverInstallAsync(app, reason)
        }
    }

    /** From the package broadcast: off the main thread, the hide waits for a running policy apply. */
    fun onPackageAddedAsync(context: Context, packageName: String, replacing: Boolean) {
        val app = context.applicationContext
        guard.execute {
            runCatching { onPackageAdded(app, packageName, replacing) }
                .onFailure { Log.e(TAG, "app update guard failed for $packageName", it) }
        }
    }

    private val guard = Executors.newSingleThreadExecutor()

    /** Waits for the guard's queued work; tests only. */
    internal fun awaitGuardForTests() {
        guard.submit {}.get(10, java.util.concurrent.TimeUnit.SECONDS)
    }

    /**
     * The guard, for every package Android reports as added while the app runs. An update of an
     * installed app is counted; a new app is hidden at once and held back until the server has it.
     */
    fun onPackageAdded(context: Context, packageName: String, replacing: Boolean) {
        val app = context.applicationContext
        if (!Mode.isStrong(app)) return
        // A catalog app the parents approved may finish installing during or just after the window.
        val rules = SyncStore(app).rules()
        if (!replacing && rules != null && !rules.openApps && packageName in rules.allowedApps) return
        val verdict = log(app).packageAdded(packageName, replacing, System.currentTimeMillis(), isOpen(app))
        if (verdict != AppUpdateLog.Verdict.HIDE) return
        holdBack(app, packageName)
        if (!Lock.hideNewApp(app, packageName)) Log.i(TAG, "new app $packageName has no icon to hide")
        Lock.applyAsync(app, "new app during app update window")
        // The sync the install itself started may have reported before this verdict was saved.
        SyncScheduler.appUpdates(app, "new app caught in the app update window")
    }

    @Synchronized
    @SuppressLint("ApplySharedPref") // On disk before the lock reads it.
    private fun holdBack(app: Context, packageName: String) {
        prefs(app).edit().putStringSet(HELD_BACK, heldBack(app) + packageName).commit()
    }

    @Synchronized
    @SuppressLint("ApplySharedPref")
    private fun letGo(app: Context, packages: Set<String>) {
        prefs(app).edit().putStringSet(HELD_BACK, heldBack(app) - packages).commit()
    }

    /** What [onRules] does; pure, so the decisions are tested on the JVM. */
    internal data class RulesPlan(
        /** Held-back apps the server has made requests of: its rules decide about them now. */
        val letGo: Set<String> = emptySet(),
        /** The parents switched the nightly window off while one was open. */
        val closeNightly: Boolean = false,
        /** A new "Update apps now" to mark as handled, before acting on it. */
        val handleRequest: Long? = null,
        /** Whether that request is fresh enough to open a window. */
        val openForParent: Boolean = false,
    )

    /** [openTrigger] is what opened the window that is open now, or null when none is. */
    internal fun plan(
        rules: AppUpdateRules,
        heldBack: Set<String>,
        handledRequestMs: Long,
        openTrigger: AppUpdateLog.Trigger?,
        nowMs: Long,
        /** The window the phone reports now: the server's recorded apps count only once it holds this one. */
        currentWindowId: String? = null,
    ): RulesPlan {
        val requested = rules.requestedAt?.toEpochMilli()?.takeIf { it > handledRequestMs }
        // recordedApps of an earlier window can list an app that was installed again: its request
        // has not been made yet, so it stays held back until the server has recorded this window.
        val recorded = if (currentWindowId != null && rules.reportedWindow == currentWindowId) rules.recordedApps else emptySet()
        return RulesPlan(
            letGo = heldBack intersect recorded,
            closeNightly = !rules.automatic && openTrigger == AppUpdateLog.Trigger.NIGHT,
            handleRequest = requested,
            openForParent = requested != null && nowMs - requested <= REQUEST_MAX_AGE_MS,
        )
    }

    /**
     * After every sync: lets go of held-back apps once the server has recorded them (its rules
     * decide from then on), closes a nightly window the parents switched off, and acts on a new
     * "Update apps now".
     */
    fun onRules(context: Context, nowMs: Long = System.currentTimeMillis()) {
        val app = context.applicationContext
        val rules = SyncStore(app).rules()?.appUpdates ?: return
        val p = prefs(app)
        val window = log(app).current()
        val openTrigger = if (isOpen(app)) window?.trigger else null
        val plan = plan(rules, heldBack(app), p.getLong(HANDLED_REQUEST, 0L), openTrigger, nowMs, window?.id)
        if (plan.letGo.isNotEmpty()) {
            letGo(app, plan.letGo)
            Lock.applyAsync(app, "new apps from the app update window reached the parents")
        }
        if (plan.closeNightly) close(app, "automatic app updates switched off")
        // Handled first: a failure is reported once, never retried in a loop.
        plan.handleRequest?.let { p.edit().putLong(HANDLED_REQUEST, it).apply() }
        if (plan.openForParent) open(app, AppUpdateLog.Trigger.PARENT)
    }

    /**
     * From the install lease when a catalog or app update window closed: the parents see the end
     * of an app update window right away, not at the next periodic sync. Once per window.
     */
    fun onLeaseClosed(context: Context) {
        val app = context.applicationContext
        val id = log(app).current()?.takeIf { it.openedAtMs != null }?.id ?: return
        if (isOpen(app)) return
        val p = prefs(app)
        synchronized(this) {
            if (p.getString(CLOSE_REPORTED, null) == id) return
            // Pending until the server has the report: a sync that fails offline is retried with backoff.
            p.edit().putString(CLOSE_REPORTED, id).putString(CLOSE_PENDING, id).apply()
        }
        runCatching { catchMissed(app) }.onFailure { Log.w(TAG, "could not look for apps installed unseen", it) }
        SyncScheduler.appUpdates(app, "app update window closed")
    }

    /** Apps installed while the process was dead never reached the guard: hide them and make them requests too. */
    private fun catchMissed(app: Context) {
        if (!Mode.isStrong(app)) return
        val rules = SyncStore(app).rules()
        val missed = log(app).missed(installedPackages(app), System.currentTimeMillis()) { pkg ->
            pkg == app.packageName || (rules != null && !rules.openApps && pkg in rules.allowedApps)
        }
        if (missed.isEmpty()) return
        missed.forEach { pkg ->
            holdBack(app, pkg)
            if (!Lock.hideNewApp(app, pkg)) Log.i(TAG, "new app $pkg has no icon to hide")
        }
        Lock.applyAsync(app, "new app installed unseen during the app update window")
    }

    /** Whether the close of the last window still has to reach the server (SyncWorker retries until it has). */
    fun closeReportPending(context: Context): Boolean = prefs(context).getString(CLOSE_PENDING, null) != null

    /** The server accepted a status report: a closed window in it ends the pending retry. */
    fun onReported(context: Context, report: AppUpdateLog.Report) {
        val p = prefs(context)
        val pending = p.getString(CLOSE_PENDING, null) ?: return
        // A report about another window means a newer window has opened: stop retrying the old close.
        if (report.id != pending || report.closedAtMs != null) p.edit().remove(CLOSE_PENDING).apply()
    }

    /** The nightly check (AppUpdateWorker). Returns whether a window opened. */
    fun openNightlyIfDue(context: Context, conditions: AppUpdateNight.Conditions, now: Instant = Instant.now()): Boolean {
        val app = context.applicationContext
        val zone = SyncStore(app).rules()?.timezone ?: java.time.ZoneId.systemDefault()
        val p = prefs(app)
        val last = p.getString(LAST_NIGHT, null)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        val night = AppUpdateNight.due(now, zone, last, conditions) ?: return false
        val result = open(app, AppUpdateLog.Trigger.NIGHT)
        // Also when another window is open already: that one serves this night.
        if (result == OpenResult.OPENED || result == OpenResult.ALREADY_OPEN) {
            p.edit().putString(LAST_NIGHT, night.toString()).apply()
        }
        return result == OpenResult.OPENED
    }

    /** The last window for `PUT /device/status`; null before the first one. */
    fun report(context: Context): AppUpdateLog.Report? = runCatching {
        // Held-back apps from an earlier window the server never heard about ride along.
        log(context).report(System.currentTimeMillis(), isOpen(context))
            ?.let { it.copy(caught = (it.caught + heldBack(context)).distinct().sorted()) }
    }.getOrNull()

    /** Every package on the phone, hidden ones included. */
    private fun installedPackages(context: Context): Set<String> {
        val pm = context.packageManager
        val flags = PackageManager.MATCH_UNINSTALLED_PACKAGES
        val list = if (Build.VERSION.SDK_INT >= 33) {
            pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(flags.toLong()))
        } else {
            @Suppress("DEPRECATION")
            pm.getInstalledPackages(flags)
        }
        return list.map { it.packageName }.toSet()
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private const val HELD_BACK = "held_back"
    private const val CLOSE_REPORTED = "close_reported"
    private const val CLOSE_PENDING = "close_pending"
    private const val HANDLED_REQUEST = "handled_request"
    private const val LAST_NIGHT = "last_night"

    private class PrefsLogStore(context: Context) : AppUpdateLog.Store {
        private val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        override fun load(): AppUpdateLog.Window? =
            prefs.getString(WINDOW, null)?.let { runCatching { AppUpdateLog.Window.parse(it) }.getOrNull() }

        @SuppressLint("ApplySharedPref") // The guard's verdict must survive a crash right after it.
        override fun save(window: AppUpdateLog.Window) {
            prefs.edit().putString(WINDOW, window.toJson().toString()).commit()
        }

        companion object {
            private const val WINDOW = "window"
        }
    }
}
