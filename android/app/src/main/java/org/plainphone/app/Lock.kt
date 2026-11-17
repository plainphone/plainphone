// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.Log
import java.text.DateFormat
import java.time.Instant
import java.util.Date
import java.util.concurrent.Executors
import org.plainphone.app.settings.AndroidSettingsControls
import org.plainphone.app.settings.PrefsPresetStore
import org.plainphone.app.settings.SettingsApplier
import org.plainphone.app.sync.EffectivePolicy
import org.plainphone.app.sync.LockState
import org.plainphone.app.sync.Schedules
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.light.LightLock
import org.plainphone.app.light.LightRelease
import org.plainphone.app.light.Mode
import org.plainphone.app.light.Protections
import org.plainphone.app.time.TimeGuard
import org.plainphone.app.update.InstallLease

/** Glue between Android entry points and [PolicyApplier]. */
object Lock {
    private const val TAG = "Plainphone"
    private val APPLY_LOCK = Any()
    private val executor = Executors.newSingleThreadExecutor()

    fun applier(context: Context): PolicyApplier {
        val app = context.applicationContext
        val device = AndroidDeviceControls(app)
        return PolicyApplier(
            device,
            PrefsHiddenAppsStore(app),
            Build.VERSION.SDK_INT,
            settings = SettingsApplier(device, AndroidSettingsControls(app), PrefsPresetStore(app), Build.VERSION.SDK_INT),
            installsAllowed = { config ->
                InstallLease.android(app).allowsInstall(config.installing != null)
            },
        )
    }

    /** Applies the lock on a background thread (private DNS does network I/O). */
    fun applyAsync(context: Context, reason: String, done: ((List<StepResult>) -> Unit)? = null) {
        val app = context.applicationContext
        executor.execute {
            // done() must always run: provisioning and boot broadcasts wait for it.
            val results = guarded("apply") { applyNow(app, reason) }
            done?.invoke(results)
        }
    }

    fun applyForInstall(context: Context, reason: String, catalogChanged: Boolean) = synchronized(APPLY_LOCK) {
        if (isInMaintenanceWindow(context)) return@synchronized
        val result = if (catalogChanged) {
            val results = applyNow(context, reason)
            results.firstOrNull { it.name == PolicyApplier.INSTALL_RESTRICTION_STEP || it.name == "device owner" }
        } else {
            applier(context).applyInstallRestriction(effectiveConfig(context))
        }
        check(result?.ok != false) { result?.detail ?: "Android could not apply the install restriction" }
    }

    fun <T> createUpdateSession(context: Context, create: () -> T): T = synchronized(APPLY_LOCK) {
        check(!isInMaintenanceWindow(context)) { "Maintenance unlock is active" }
        // Android checks DISALLOW_INSTALL_APPS when creating the session. Keep the
        // restriction in place while writing, committing and waiting for its result.
        InstallLease.android(context).hold(InstallLease.SELF_UPDATE, 10_000L, create)
    }

    fun recoverInstallAsync(context: Context, reason: String = "recover install restriction", done: () -> Unit = {}) {
        runInstallRecovery(done) { recoverInstall(context, reason) }
    }

    fun onInstallResult(context: Context, sessionId: Int, done: () -> Unit) {
        runInstallRecovery(done) { InstallLease.android(context).finishSession(sessionId) }
    }

    fun recoverInstall(context: Context, reason: String = "recover install restriction") = synchronized(APPLY_LOCK) {
        if (!isInMaintenanceWindow(context)) InstallLease.android(context).recover(reason)
    }

    private fun runInstallRecovery(done: () -> Unit, recover: () -> Unit) {
        executor.execute {
            try {
                recover()
            } catch (e: Exception) {
                Log.e(TAG, "could not recover install restriction", e)
            } finally {
                done()
            }
        }
    }

    /** The lock config right now: the QR code's, with the parent's last known rules merged in. */
    fun effectiveConfig(context: Context, now: Instant = Instant.now()): PolicyConfig {
        val sync = SyncStore(context)
        return EffectivePolicy.merge(
            ConfigStore(context).load(),
            sync.rules(),
            now,
            removed = sync.removed,
            timeBlocked = TimeGuard.blockedNow(context, now),
            installing = InstallWindow.current(context, now.toEpochMilli()),
        )
    }

    /** Blocking. Never call on the main thread. */
    fun applyNow(context: Context, reason: String): List<StepResult> = synchronized(APPLY_LOCK) {
        // A parent released this phone: nothing locks it again, whatever wakes us (boot, an alarm, the screen).
        val sync = SyncStore(context)
        if (sync.released) return listOf(StepResult("lock", true, "released by a parent; nothing applied"))
        // A release that has not finished yet: do not lock again in between, the next sync retries it.
        if (sync.releaseAsked) return listOf(StepResult("lock", true, "release in progress; nothing applied"))
        val config = effectiveConfig(context)
        // Light mode (not Device Owner): the guard and the VPN enforce a plan instead (docs/light-mode.md).
        val results = if (Mode.isLight(context)) {
            LightLock.apply(context, config)
        } else {
            applier(context).apply(config) + usageAccessStep(context)
        }
        clearMaintenanceWindow(context)
        saveReport(context, "apply ($reason)", results)
        saveApplied(context, config, results)
        scheduleNextWindowChange(context)
        return results
    }

    /**
     * Applies the lock if the merged config differs from the last applied one (new rules, a
     * school-time window starting or ending) or the last run is older than [maxAgeMs].
     * Does nothing during a maintenance unlock. Blocking.
     */
    fun applyIfNeeded(context: Context, reason: String, maxAgeMs: Long): List<StepResult>? = synchronized(APPLY_LOCK) {
        // Checked under the lock that lift() also takes, so a sync cannot run into a starting unlock.
        if (isInMaintenanceWindow(context)) return null
        SyncStore(context).let { if (it.released || it.releaseAsked) return null }
        recoverInstall(context, reason)
        val p = prefs(context)
        val fresh = System.currentTimeMillis() - p.getLong("applied_at", 0L) < maxAgeMs
        if (fresh && p.getString("applied_fingerprint", null) == EffectivePolicy.fingerprint(effectiveConfig(context))) {
            // Back-to-back windows can leave the config unchanged: still arm the next change.
            scheduleNextWindowChange(context)
            return null
        }
        return applyNow(context, reason)
    }

    /** Strong mode: time limits count with usage access, which only the user can grant (Today screen). */
    private fun usageAccessStep(context: Context): List<StepResult> {
        if (SyncStore(context).rules()?.timeLimits?.isEmpty != false) return emptyList()
        return listOf(StepResult("usage access (time limits)", TimeGuard.hasUsageAccess(context), "Plainphone > Today"))
    }

    /** When the lock was first applied on this phone (the setup moment). Null before that. */
    fun firstAppliedAtMs(context: Context): Long? = prefs(context).getLong("first_applied_at", 0L).takeIf { it > 0 }

    /** What the parent's dashboard shows about the lock. */
    fun lockState(context: Context): LockState {
        val p = prefs(context)
        val dpm = context.getSystemService(android.app.admin.DevicePolicyManager::class.java)
        val owner = dpm?.isDeviceOwnerApp(context.packageName) == true
        val hasLimits = SyncStore(context).rules()?.timeLimits?.isEmpty == false
        return LockState(
            mode = if (owner) Mode.STRONG else Mode.LIGHT,
            protections = runCatching {
                Protections.read(context, p.getString("dns_in_use", null), needsUsageAccess = hasLimits).toMap()
            }.getOrNull(),
            deviceOwner = owner,
            maintenance = isInMaintenanceWindow(context),
            failedPolicies = p.getString("applied_failed", null)?.split('\n')?.filter { it.isNotEmpty() }.orEmpty(),
            appliedAtMs = p.getLong("applied_at", 0L).takeIf { it > 0 },
            dnsHost = p.getString("dns_in_use", null),
        )
    }

    private fun saveApplied(context: Context, config: PolicyConfig, results: List<StepResult>) {
        val now = System.currentTimeMillis()
        val edit = prefs(context).edit()
            .putLong("applied_at", now)
            .putString("applied_fingerprint", EffectivePolicy.fingerprint(config))
            .putString("applied_failed", results.filterNot { it.ok }.joinToString("\n") { it.name })
        // Android keeps the old host when the new one does not answer, so only a success changes it.
        if (results.any { (it.name == "private DNS" || it.name == "DNS filter (VPN)") && it.ok }) edit.putString("dns_in_use", config.dnsHost)
        val wasOwner = results.none { it.name == "device owner" && !it.ok }
        if (wasOwner && !prefs(context).contains("first_applied_at")) {
            edit.putLong("first_applied_at", now)
        }
        edit.apply()
    }

    /** School time and bedtime start and end on time even if nothing else wakes the app. */
    private fun scheduleNextWindowChange(context: Context) {
        val am = context.getSystemService(AlarmManager::class.java)
        val rules = SyncStore(context).rules()
        val now = Instant.now()
        val windowChange = rules?.let { Schedules.nextBoundary(it.schedules, now, it.timezone) }
        // Time limits start again at local midnight: used-up apps come back then.
        val midnight = rules?.takeIf { !it.timeLimits.isEmpty }?.let {
            now.atZone(it.timezone).toLocalDate().plusDays(1).atStartOfDay(it.timezone).toInstant()
        }
        val next = listOfNotNull(windowChange, midnight).minOrNull()
        if (next == null) {
            am.cancel(windowIntent(context))
            return
        }
        // Inexact but allowed while idle: exact alarms need a permission the user must grant.
        // The window is also re-checked whenever the screen turns on and on every sync.
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, next.toEpochMilli() + 1_000L, windowIntent(context))
    }

    private fun windowIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        1,
        Intent(context, RelockReceiver::class.java).setAction(RelockReceiver.ACTION_WINDOW),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** For alarms and screen-on: re-applies only if the merged config changed (or is 15 min old); never during maintenance. */
    fun applyIfNeededAsync(context: Context, reason: String, done: () -> Unit) {
        val app = context.applicationContext
        executor.execute {
            try {
                applyIfNeeded(app, reason, maxAgeMs = org.plainphone.app.sync.SyncRunner.APPLY_MAX_AGE_MS)
            } catch (e: Exception) {
                Log.e(TAG, "apply crashed", e)
            } finally {
                done()
            }
        }
    }

    fun liftAsync(context: Context, done: (List<StepResult>) -> Unit) {
        val app = context.applicationContext
        executor.execute {
            val results = guarded("lift") {
                synchronized(APPLY_LOCK) {
                    val minutes = ConfigStore(app).load().relockMinutes
                    scheduleRelock(app, minutes)
                    org.plainphone.app.home.HomeGuard.reset(app)
                    // Light mode: the guard pauses while the window is open; nothing else to lift.
                    val lifted = if (Mode.isLight(app)) {
                        listOf(StepResult("guard paused", true, "$minutes min"))
                    } else {
                        applier(app).lift()
                    }
                    lifted.also { saveReport(app, "maintenance unlock for $minutes min", it) }
                }
            }
            done(results)
        }
    }

    fun releaseAsync(context: Context, done: (List<StepResult>) -> Unit) {
        val app = context.applicationContext
        executor.execute { done(guarded("release") { releaseNow(app) }) }
    }

    /**
     * Gives the phone back for good: cancels the relock and the school-time alarm, then undoes the
     * lock the way the mode needs (light mode: device admin, VPN, guard; strong mode: policies and
     * Device Owner). The maintenance screen and a parent's release from the dashboard both end here.
     * Blocking. Never call on the main thread.
     */
    fun releaseNow(context: Context): List<StepResult> = synchronized(APPLY_LOCK) {
        cancelRelock(context)
        context.getSystemService(AlarmManager::class.java).cancel(windowIntent(context))
        if (Mode.isLight(context)) {
            LightRelease.release(context).also { saveReport(context, "light mode switched off", it) }
        } else {
            applier(context).release().also { saveReport(context, "released Device Owner", it) }
        }
    }

    private inline fun guarded(name: String, block: () -> List<StepResult>): List<StepResult> = try {
        block()
    } catch (e: Exception) {
        Log.e(TAG, "$name crashed", e)
        listOf(StepResult(name, false, "${e.javaClass.simpleName}: ${e.message}"))
    }

    fun isInMaintenanceWindow(context: Context): Boolean =
        prefs(context).getLong("relock_at_wall", 0L) > System.currentTimeMillis()

    fun lastReport(context: Context): String =
        prefs(context).getString("last_report", null) ?: "No policy run yet."

    private fun scheduleRelock(context: Context, minutes: Int) {
        val delayMs = minutes * 60_000L
        context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            SystemClock.elapsedRealtime() + delayMs,
            relockIntent(context),
        )
        prefs(context).edit().putLong("relock_at_wall", System.currentTimeMillis() + delayMs).apply()
    }

    private fun cancelRelock(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(relockIntent(context))
        clearMaintenanceWindow(context)
    }

    private fun clearMaintenanceWindow(context: Context) {
        prefs(context).edit().remove("relock_at_wall").apply()
    }

    private fun relockIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        0,
        Intent(context, RelockReceiver::class.java).setAction(RelockReceiver.ACTION_RELOCK),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    private fun saveReport(context: Context, title: String, results: List<StepResult>) {
        val stamp = DateFormat.getDateTimeInstance().format(Date())
        val text = buildString {
            appendLine("$title, $stamp")
            results.forEach { appendLine(it.toString()) }
        }
        results.forEach { Log.i(TAG, it.toString()) }
        prefs(context).edit().putString("last_report", text).apply()
    }

    private fun prefs(context: Context) = context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE)
}

class PrefsHiddenAppsStore(context: Context) : HiddenAppsStore {
    private val prefs = context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE)
    override fun load(): Set<String> = prefs.getStringSet("hidden_apps", null)?.toSet() ?: emptySet()
    override fun save(packages: Set<String>) {
        prefs.edit().putStringSet("hidden_apps", packages).apply()
    }
    override fun loadSuspended(): Set<String> = prefs.getStringSet("suspended_apps", null)?.toSet() ?: emptySet()
    override fun saveSuspended(packages: Set<String>) {
        prefs.edit().putStringSet("suspended_apps", packages).apply()
    }
}
