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
import java.util.Date
import java.util.concurrent.Executors
import org.plainphone.app.provisioning.BootloaderWarning
import org.plainphone.app.quiet.BedtimeDnd
import org.plainphone.app.quiet.DndOutcome
import org.plainphone.app.settings.AndroidSettingsControls
import org.plainphone.app.settings.PrefsPresetStore
import org.plainphone.app.settings.SettingsApplier
import org.plainphone.app.sync.AppliedRulesReceipt
import org.plainphone.app.sync.EffectivePolicy
import org.plainphone.app.sync.LiftedPolicy
import org.plainphone.app.sync.LockState
import org.plainphone.app.sync.Schedules
import org.plainphone.app.sync.StatusNotices
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.catalog.CatalogAccounts
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.light.LightLock
import org.plainphone.app.light.LightRelease
import org.plainphone.app.light.Mode
import org.plainphone.app.light.Protections
import org.plainphone.app.time.TimeGuard
import org.plainphone.app.time.TrustedClock
import org.plainphone.app.time.TrustedTime
import org.plainphone.app.update.AppUpdateWindow
import org.plainphone.app.update.InstallLease
import org.plainphone.app.update.PlayExplanation
import org.plainphone.app.update.UpdateBatteryExemption

/** Glue between Android entry points and [PolicyApplier]. */
object Lock {
    private const val TAG = "Plainphone"
    private const val BEDTIME_STEP = "silent bedtime (Do Not Disturb)"
    private const val ACCOUNT_RELOCK_PENDING = "account_relock_pending"
    private val APPLY_LOCK = Any()
    private val executor = Executors.newSingleThreadExecutor()
    private val installRecoveryExecutor = Executors.newSingleThreadExecutor()

    fun applier(context: Context, onInstallsAllowed: () -> Unit = {}): PolicyApplier {
        val app = context.applicationContext
        val device = AndroidDeviceControls(app)
        val sdk = Build.VERSION.SDK_INT
        val installLease = InstallLease.android(app)
        return PolicyApplier(
            device,
            PrefsHiddenAppsStore(app),
            sdk,
            hardening = Hardening(AndroidHardeningControls(app), sdk),
            settings = SettingsApplier(device, AndroidSettingsControls(app), PrefsPresetStore(app), sdk),
            onInstallsAllowed = onInstallsAllowed,
            clearInstallsIfAllowed = { config, clear ->
                installLease.clearIfAllowed(config.installing != null, clear)
            },
            installsAllowed = { config -> installLease.allowsInstall(config.installing != null) },
            enforceAccountRestriction = installLease::enforceAccountRestriction,
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

    fun applyForInstall(
        context: Context,
        reason: String,
        catalogChanged: Boolean,
        onInstallsAllowed: () -> Unit = {},
    ) = synchronized(APPLY_LOCK) {
        check(!isInMaintenanceWindow(context)) { "Maintenance unlock is active" }
        val sync = SyncStore(context)
        check(!sync.released && !sync.releaseAsked) { "Phone release is active" }
        val result = if (catalogChanged) {
            check(effectiveConfig(context).installing != null) { "Catalog target is no longer eligible" }
            val results = applyNow(context, reason, onInstallsAllowed)
            results.firstOrNull { it.name == PolicyApplier.INSTALL_RESTRICTION_STEP || it.name == "device owner" }
        } else {
            applier(context, onInstallsAllowed).applyInstallRestriction(effectiveConfig(context))
        }
        check(result?.ok != false) { result?.detail ?: "Android could not apply the install restriction" }
    }

    /** Applies the open app update window: Play shown, installs allowed (update/AppUpdateWindow.kt). */
    fun applyForAppUpdates(context: Context, reason: String) = synchronized(APPLY_LOCK) {
        check(!isInMaintenanceWindow(context)) { "Maintenance unlock is active" }
        val sync = SyncStore(context)
        check(!sync.released && !sync.releaseAsked) { "Phone release is active" }
        check(effectiveConfig(context).updatingApps) { "App update window is no longer open" }
        val result = applyNow(context, reason).firstOrNull {
            it.name == PolicyApplier.INSTALL_RESTRICTION_STEP || it.name == "device owner"
        }
        check(result?.ok != false) { result?.detail ?: "Android could not lift the install restriction" }
    }

    /**
     * The app update guard: hides a new app at once, under the policy lock so the hidden list stays
     * right. Only apps with an icon: a library Play installs alongside an update must keep working.
     */
    fun hideNewApp(context: Context, pkg: String): Boolean = synchronized(APPLY_LOCK) {
        val device = AndroidDeviceControls(context)
        if (!device.isDeviceOwner() || pkg !in device.launchablePackages() || pkg in device.corePackages()) {
            return false
        }
        val hidden = runCatching { device.setHidden(pkg, true) || device.isHidden(pkg) }.getOrDefault(false)
        if (hidden) PrefsHiddenAppsStore(context).let { it.save(it.load() + pkg) }
        hidden
    }

    fun <T> createUpdateSession(context: Context, create: () -> T): T = synchronized(APPLY_LOCK) {
        check(!isInMaintenanceWindow(context)) { "Maintenance unlock is active" }
        // Android checks DISALLOW_INSTALL_APPS when creating the session. Keep the
        // restriction in place while writing, committing and waiting for its result.
        InstallLease.android(context).hold(InstallLease.SELF_UPDATE, 10_000L, create)
    }

    fun recoverInstallAsync(
        context: Context,
        reason: String = "recover install restriction",
        force: Boolean = false,
        done: () -> Unit = {},
    ) {
        runInstallRecovery(done) { InstallLease.android(context).recover(reason, force) }
    }

    fun onInstallResult(context: Context, sessionId: Int, done: () -> Unit) {
        runInstallRecovery(done) { InstallLease.android(context).finishSession(sessionId) }
    }

    fun recoverInstall(context: Context, reason: String = "recover install restriction") {
        InstallLease.android(context).recover(reason)
    }

    private fun runInstallRecovery(done: () -> Unit, recover: () -> Unit) {
        installRecoveryExecutor.execute {
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
    fun effectiveConfig(context: Context, time: TrustedTime = TrustedClock.of(context).now()): PolicyConfig {
        val sync = SyncStore(context)
        val install = InstallWindow.current(context, time.ms)
        return EffectivePolicy.merge(
            ConfigStore(context).load(),
            sync.rules(),
            time.instant,
            removed = sync.removed,
            timeBlocked = TimeGuard.blockedNow(context, time),
            installing = install,
            time = time,
        ).copy(updatingApps = AppUpdateWindow.isOpen(context), heldBack = AppUpdateWindow.heldBack(context))
    }

    /** Blocking. Never call on the main thread. */
    fun applyNow(context: Context, reason: String): List<StepResult> = applyNow(context, reason) {}

    private fun applyNow(
        context: Context,
        reason: String,
        onInstallsAllowed: () -> Unit,
    ): List<StepResult> = synchronized(APPLY_LOCK) {
        // A parent released this phone: nothing locks it again, whatever wakes us (boot, an alarm, the screen).
        val sync = SyncStore(context)
        if (sync.released) return listOf(StepResult("lock", true, "released by a parent; nothing applied"))
        // A release that has not finished yet: do not lock again in between, the next sync retries it.
        if (sync.releaseAsked || sync.setupUndoPending) return listOf(StepResult("lock", true, "release in progress; nothing applied"))
        val receiptEtag = sync.etag?.takeIf { sync.rules()?.changeReceiptsEnabled == true }
        val config = effectiveConfig(context)
        if (!Mode.isLight(context) && BootloaderWarning.needsAcknowledgement(context)) {
            return listOf(StepResult("bootloader warning", false, "confirm the warning on the phone")).also {
                saveReport(context, "apply ($reason)", it)
                saveApplied(context, config, it, waitingForBootWarning = true)
            }
        }
        // Light mode (not Device Owner): the guard and the VPN enforce a plan instead (docs/light-mode.md).
        val locked = if (Mode.isLight(context)) {
            LightLock.apply(context, config).also {
                if (config.installing != null) onInstallsAllowed()
            }
        } else {
            applier(context, onInstallsAllowed).apply(config) + usageAccessStep(context) +
                listOfNotNull(UpdateBatteryExemption.failure(context))
        }
        val results = locked + silentBedtimeStep(context, config.server?.quietBedtime == true)
        prefs(context).edit().remove(ACCOUNT_RELOCK_PENDING).apply()
        clearMaintenanceWindow(context)
        saveReport(context, "apply ($reason)", results)
        saveApplied(context, config, results, receiptEtag = receiptEtag?.takeIf { it == sync.etag })
        scheduleNextWindowChange(context)
        syncPlayExplanation(context)
        return results
    }

    /**
     * The config fingerprint plus, in open mode, the blocked apps that are on the phone right now:
     * installing one later changes it, so the lock re-applies within seconds, not after the max age.
     */
    private fun appliedFingerprint(context: Context, config: PolicyConfig): String {
        val installedBlocked = config.openBlocked
            ?.let { blocked -> AndroidDeviceControls(context).launchablePackages().filter { it in blocked }.sorted().joinToString(",") }
        return EffectivePolicy.fingerprint(config) + "|" + (installedBlocked ?: "-")
    }

    /**
     * Applies the lock if the merged config differs from the last applied one (new rules, a
     * school-time window starting or ending) or the last run is older than [maxAgeMs].
     * Does nothing during a maintenance unlock. Blocking.
     */
    fun applyIfNeeded(context: Context, reason: String, maxAgeMs: Long): List<StepResult>? = synchronized(APPLY_LOCK) {
        // Checked under the lock that lift() also takes, so a sync cannot run into a starting unlock.
        if (isInMaintenanceWindow(context)) return null
        val sync = SyncStore(context)
        if (sync.released || sync.releaseAsked || sync.setupUndoPending) return null
        recoverInstall(context, reason)
        val p = prefs(context)
        // A last run "in the future" (the clock was set back since) is never fresh.
        val fresh = System.currentTimeMillis() - p.getLong("applied_at", 0L) in 0 until maxAgeMs
        val etag = sync.etag
        val receiptPending = etag != null && sync.rules()?.changeReceiptsEnabled == true &&
            p.getString("receipt_attempt_etag", null) != etag
        val config = effectiveConfig(context)
        val vpnRecovered = Mode.isLight(context) && LightLock.vpnUses(config.dnsHost) &&
            (p.getBoolean("vpn_waiting", false) ||
                p.getString("applied_failed", null)?.lineSequence()?.any { it == LightLock.DNS_STEP } == true)
        val accountRelockPending = p.getBoolean(ACCOUNT_RELOCK_PENDING, false)
        if (fresh && !receiptPending && !vpnRecovered && !accountRelockPending &&
            p.getString("applied_fingerprint", null) == appliedFingerprint(context, config)
        ) {
            // Back-to-back windows can leave the config unchanged: still arm the next change.
            scheduleNextWindowChange(context)
            return null
        }
        return applyNow(context, reason)
    }

    /**
     * Silent bedtime (docs/bedtime.md): Do Not Disturb on while bedtime is on, the phone's own setting
     * back afterwards. Never a failure: without Android's access, calls and Plainphone's own
     * notifications are still silent, and the maintenance screen says what is missing.
     */
    private fun silentBedtimeStep(context: Context, silent: Boolean): List<StepResult> = try {
        if (BedtimeDnd.forContext(context).apply(silent) == DndOutcome.NO_ACCESS) {
            listOf(StepResult(BEDTIME_STEP, true, "no Do Not Disturb access: only Plainphone's own calls and messages are silent"))
        } else emptyList()
    } catch (e: Exception) {
        Log.e(TAG, "silent bedtime failed", e)
        listOf(StepResult(BEDTIME_STEP, true, e.javaClass.simpleName))
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
        val rules = SyncStore(context).rules()
        val hasLimits = rules?.timeLimits?.isEmpty == false
        val failed = p.getString("applied_failed", null)?.split('\n')
            ?.filter { it.isNotEmpty() && it != UpdateBatteryExemption.FAILED_POLICY }.orEmpty()
        return LockState(
            mode = if (owner) Mode.STRONG else Mode.LIGHT,
            protections = runCatching {
                Protections.read(context, p.getString("dns_in_use", null), needsUsageAccess = hasLimits).toMap()
            }.getOrNull(),
            deviceOwner = owner,
            maintenance = isInMaintenanceWindow(context),
            failedPolicies = if (UpdateBatteryExemption.isMissing(context))
                listOf(UpdateBatteryExemption.FAILED_POLICY) + failed else failed,
            appliedAtMs = p.getLong("applied_at", 0L).takeIf { it > 0 },
            dnsHost = p.getString("dns_in_use", null),
            resetProtection = p.getString("reset_protection", null),
            callRoleActionNeeded = p.getBoolean("call_role_action_needed", false),
            accountTypes = p.getStringSet("account_types", null)?.sorted(),
            receipt = p.getString("receipt_etag", null)?.let { etag ->
                p.getLong("receipt_applied_at", 0L).takeIf { it > 0 }?.let { AppliedRulesReceipt(etag, it) }
            },
            webFilterActive = rules?.dnsHost?.takeIf { rules.healthBoardEnabled && rules.dnsReady }?.let { host ->
                Protections.webFilterActive(context, host, owner)
            },
            liftedPolicies = LiftedPolicy.read(context, owner),
        )
    }

    private fun saveApplied(
        context: Context,
        config: PolicyConfig,
        results: List<StepResult>,
        waitingForBootWarning: Boolean = false,
        receiptEtag: String? = null,
    ) {
        val now = System.currentTimeMillis()
        val edit = prefs(context).edit()
            .putString("applied_failed", results.filterNot { it.ok }.joinToString("\n") {
                if (it.name == Hardening.EXTRA_USERS && it.detail.contains("extra profile present")) {
                    "${it.name}: ${it.detail}".take(200)
                } else {
                    it.name
                }
            })
        edit.putBoolean("call_role_action_needed", Hardening.callRoleActionNeeded(results))
        if (Hardening.parallelAppsRemoved(results)) StatusNotices(context).record(StatusNotices.PARALLEL_APPS_REMOVED)
        if (waitingForBootWarning) {
            // Report the failure without counting this as an applied configuration.
            edit.remove("applied_fingerprint").remove("applied_at").apply()
            return
        }
        edit.putString("receipt_attempt_etag", receiptEtag)
        edit.putBoolean("vpn_waiting", results.any { it.waiting })
        if (receiptEtag == null) {
            edit.remove("receipt_etag").remove("receipt_applied_at")
        } else if (receiptEtag != prefs(context).getString("receipt_etag", null) &&
            results.all { (it.ok && !it.waiting) || it.name == UpdateBatteryExemption.FAILED_POLICY }
        ) {
            edit.putString("receipt_etag", receiptEtag).putLong("receipt_applied_at", now)
        }
        edit.remove("owner_release_started")
            .putLong("applied_at", now)
            .putString("applied_fingerprint", appliedFingerprint(context, config))
        // Android keeps the old host when the new one does not answer, so only a success changes it.
        if (results.any { (it.name == "private DNS" || it.name == LightLock.DNS_STEP) && it.ok && !it.waiting }) edit.putString("dns_in_use", config.dnsHost)
        Hardening.resetProtectionState(results)?.let { edit.putString("reset_protection", it.wire) }
        Hardening.accountTypes(results)?.let { edit.putStringSet("account_types", it.toSet()) }
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
        // On the trusted time, not the phone's clock (docs/light-mode.md, "The phone's clock").
        val time = TrustedClock.of(context).now()
        val windowChange = rules?.let { r -> time.untilNext { Schedules.nextBoundary(r.schedules, it, r.timezone) } }
        // Time limits start again at local midnight: used-up apps come back then.
        val midnight = rules?.takeIf { !it.timeLimits.isEmpty }?.let { r ->
            time.untilNext { it.atZone(r.timezone).toLocalDate().plusDays(1).atStartOfDay(r.timezone).toInstant() }
        }
        // Modes switch contact groups at their slots also when no app window changes (docs/modes.md).
        val modeChange = time.untilNext { org.plainphone.app.sync.Modes.nextBoundary(rules, it) }
        val next = listOfNotNull(windowChange, midnight, modeChange).minOrNull()
        if (next == null) {
            am.cancel(windowIntent(context))
            return
        }
        // Inexact but allowed while idle: exact alarms need a permission the user must grant.
        // The boot clock, so setting the phone's clock does not move the alarm.
        // The window is also re-checked whenever the screen turns on and on every sync.
        val at = SystemClock.elapsedRealtime() + next.toMillis() + 1_000L
        am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, windowIntent(context))
    }

    private fun windowIntent(context: Context): PendingIntent = PendingIntent.getBroadcast(
        context,
        1,
        Intent(context, RelockReceiver::class.java).setAction(RelockReceiver.ACTION_WINDOW),
        PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )

    /** For alarms and screen-on: re-applies only if the merged config changed (or is 15 min old); never during maintenance. */
    fun applyIfNeededAsync(
        context: Context,
        reason: String,
        maxAgeMs: Long = org.plainphone.app.sync.SyncRunner.APPLY_MAX_AGE_MS,
        done: () -> Unit,
    ) {
        val app = context.applicationContext
        executor.execute {
            try {
                applyIfNeeded(app, reason, maxAgeMs)
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
                    // A maintenance unlock is a normal phone: bedtime's Do Not Disturb ends with it.
                    silentBedtimeStep(app, silent = false)
                    // Light mode: the guard pauses while the window is open; nothing else to lift.
                    val lifted = if (Mode.isLight(app)) {
                        listOf(StepResult("guard paused", true, "$minutes min"))
                    } else {
                        applier(app).lift()
                    }
                    lifted.also {
                        saveReport(app, "maintenance unlock for $minutes min", it)
                        syncPlayExplanation(app)
                    }
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
        silentBedtimeStep(context, silent = false)
        val state = prefs(context)
        val ownerReleaseStarted = state.getBoolean("owner_release_started", false)
        if (Mode.isStrong(context) || ownerReleaseStarted) {
            // Keep the release path across a restart after Android has cleared Device Owner.
            if (!ownerReleaseStarted && !state.edit().putBoolean("owner_release_started", true).commit()) {
                return listOf(StepResult("release", false, "could not save release progress"))
            }
            applier(context).release().also {
                saveReport(context, "released Device Owner", it)
                syncPlayExplanation(context)
            }
        } else {
            LightRelease.release(context).also { saveReport(context, "light mode switched off", it) }
        }
    }

    /** Play links explain app updates while Play is hidden (update/PlayExplanation.kt). */
    private fun syncPlayExplanation(context: Context) {
        runCatching { PlayExplanation.sync(context) }.onFailure { Log.w(TAG, "could not update the Play explanation", it) }
    }

    private inline fun guarded(name: String, block: () -> List<StepResult>): List<StepResult> = try {
        block()
    } catch (e: Exception) {
        Log.e(TAG, "$name crashed", e)
        listOf(StepResult(name, false, "${e.javaClass.simpleName}: ${e.message}"))
    }

    /** When the maintenance unlock ends (wall clock), or null when no unlock is open. */
    fun maintenanceEndsAtMs(context: Context): Long? {
        val p = prefs(context)
        val stored = MaintenanceWindow.Stored(
            wallEndMs = p.getLong("relock_at_wall", 0L),
            elapsedEndMs = p.getLong("relock_at_elapsed", 0L).takeIf { p.contains("relock_at_elapsed") },
            boot = p.getInt("relock_boot", 0).takeIf { p.contains("relock_boot") },
        )
        return MaintenanceWindow.endsAtMs(stored, System.currentTimeMillis(), BootClock.of(context))
    }

    fun isInMaintenanceWindow(context: Context): Boolean = maintenanceEndsAtMs(context) != null

    /**
     * The account restriction stayed lifted because a release was asked for. If the release is withdrawn,
     * the next [applyIfNeeded] must lock again even though the rules are unchanged.
     */
    internal fun accountRelockSkippedForRelease(context: Context) {
        prefs(context).edit().putBoolean(ACCOUNT_RELOCK_PENDING, true).apply()
    }

    fun lastReport(context: Context): String =
        prefs(context).getString("last_report", null) ?: "No policy run yet."

    private fun scheduleRelock(context: Context, minutes: Int) {
        val delayMs = minutes * 60_000L
        val clock = BootClock.of(context)
        val elapsedEnd = clock.elapsedMs() + delayMs
        context.getSystemService(AlarmManager::class.java).setAndAllowWhileIdle(
            AlarmManager.ELAPSED_REALTIME_WAKEUP,
            elapsedEnd,
            relockIntent(context),
        )
        prefs(context).edit().putLong("relock_at_wall", System.currentTimeMillis() + delayMs)
            .putLong("relock_at_elapsed", elapsedEnd).putInt("relock_boot", clock.boot()).apply()
    }

    private fun cancelRelock(context: Context) {
        context.getSystemService(AlarmManager::class.java).cancel(relockIntent(context))
        clearMaintenanceWindow(context)
    }

    private fun clearMaintenanceWindow(context: Context) {
        val wasOpen = prefs(context).contains("relock_at_wall")
        prefs(context).edit().remove("relock_at_wall").remove("relock_at_elapsed").remove("relock_boot").apply()
        if (wasOpen) runCatching { CatalogAccounts.maintenanceEnded(context) }
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
