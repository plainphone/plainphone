// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.location.LocationRequest
import android.os.BatteryManager
import android.os.Build
import android.os.Bundle
import android.os.CancellationSignal
import android.os.HandlerThread
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.Executor
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import org.plainphone.app.Compat
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.PrefsHiddenAppsStore
import org.plainphone.app.StepResult
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.update.SelfUpdate

/** Entry points for the rest of the app. */
object Sync {
    fun runner(context: Context): SyncRunner {
        val app = context.applicationContext
        return SyncRunner(SyncStore(app), PlainphoneApi(ConfigStore(app).load().serverUrl, app), AndroidSyncDevice(app))
    }
}

/** Real phone effects for [SyncRunner]. */
class AndroidSyncDevice(private val context: Context) : SyncDevice {
    override fun nowMs() = System.currentTimeMillis()

    override fun appVersion(): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"

    override fun dynamicCorePackages() = AndroidDeviceControls(context).dynamicCorePackages()

    override fun installedApps(dynamicCore: Set<String>): List<InstalledApp> {
        val pm = context.packageManager
        val controls = AndroidDeviceControls(context)
        val core = controls.corePackages(dynamicCore)
        val telephony = controls.telephonyApps()
        // The maker's phone and SMS apps are never reported as core: Plainphone hides them
        // regardless of dashboard rules so it can enforce approved contacts.
        val makerTelephony = (telephony.dialers + telephony.smsApps).filterNot { it == telephony.systemDialer }.toSet()
        // Hidden apps do not show up in the launcher query; add the ones Plainphone hid.
        val packages = controls.launchablePackages() + PrefsHiddenAppsStore(context).load().filter(controls::isInstalled)
        return packages.filter { it != context.packageName }.map { pkg ->
            val label = runCatching {
                val info = Compat.applicationInfo(pm, pkg, PackageManager.MATCH_UNINSTALLED_PACKAGES)
                pm.getApplicationLabel(info).toString()
            }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: pkg
            InstalledApp(pkg, label, core = pkg in core && pkg !in makerTelephony)
        }
    }

    override fun applyLockIfNeeded(reason: String, maxAgeMs: Long) {
        Lock.applyIfNeeded(context, reason, maxAgeMs)
    }

    override fun lockState(): LockState = Lock.lockState(context)

    override fun release(): List<StepResult> = Lock.releaseNow(context)

    override fun battery(): Pair<Int?, Boolean?> {
        val bm = context.getSystemService(BatteryManager::class.java) ?: return null to null
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }
        val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val plugged = sticky?.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
        return pct to plugged?.takeIf { it >= 0 }?.let { it != 0 }
    }

    override fun location(precise: Boolean, notBeforeMs: Long?, fresh: Boolean): LocationFix? =
        LocationReader(context).current(precise, notBeforeMs = notBeforeMs, fresh = fresh)
    override fun lastKnownLocation(): LocationFix? = LocationReader(context).lastKnown()
    override fun cachedCoarseLocation(): LocationFix? = LocationReader(context).current(precise = false, timeoutMs = 0)

    override fun appVersionCode(): Long =
        Compat.packageInfo(context.packageManager, context.packageName, 0).longVersionCode

    override fun updateReport() = SelfUpdate.report(context)

    override fun requestUpdate(requestedAtMs: Long) = SelfUpdate.request(context, requestedAtMs)

    override fun onSafetyRules(rules: ServerRules) = org.plainphone.app.safety.Safety.onRules(context, rules)
    override fun pendingSafetyEvents() = org.plainphone.app.safety.SafetyStore(context).pending()
    override fun safetyEventDone(event: SafetyEvent) = org.plainphone.app.safety.SafetyStore(context).done(event)
    override fun checkInAnswered(id: String) = org.plainphone.app.safety.SafetyStore(context).checkInAnswered(id)
    override fun positionSent(why: String) = org.plainphone.app.safety.Safety.positionSent(context, why)

    override fun timeUsed(): Map<String, Int>? = org.plainphone.app.time.TimeGuard.snapshot(context)?.let { s ->
        s.evaluation.usedMinutes(s.limits.apps.keys)
    }
}

internal const val PRECISE_ACCURACY_METERS = 100f

/**
 * One position via the platform's location service. The platform "fused" provider is used when
 * the phone has one (on phones with Google Play services it is backed by Google's fused location),
 * otherwise GPS or the network provider. No Play services library: the app stays free of it.
 */
class LocationReader(private val context: Context) {

    @SuppressLint("MissingPermission") // Granted by Device Owner when the parent turns location on.
    fun current(
        precise: Boolean,
        timeoutMs: Long = LOCATION_LOOKUP_BUDGET_MS,
        notBeforeMs: Long? = null,
        fresh: Boolean = false,
    ): LocationFix? {
        val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMs.coerceIn(0L, LOCATION_LOOKUP_BUDGET_MS))
        val lm = context.getSystemService(LocationManager::class.java) ?: return null
        if (!lm.isLocationEnabled) return null
        val enabled = lm.allProviders.filter(lm::isProviderEnabled)
        val providers = when {
            precise -> listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)
            else -> listOf(LocationManager.NETWORK_PROVIDER, LocationManager.GPS_PROVIDER)
        }.filter { it in enabled }
        val maxAge = TimeUnit.MINUTES.toNanos(if (precise) 2 else 10)
        val maxAccuracy = if (precise) PRECISE_ACCURACY_METERS else 1_000f
        val fused = listOf(FUSED).filter { it in enabled }
        if (!fresh) {
            val cachedLocations = knownLocations(lm, fused + providers)
            val now = SystemClock.elapsedRealtimeNanos()
            val cached = cachedLocations
                .filter {
                    (notBeforeMs == null || it.time >= notBeforeMs) &&
                        now - it.elapsedRealtimeNanos in 0 until maxAge && it.accuracyOrUnknown() <= maxAccuracy
                }
                .maxByOrNull { it.elapsedRealtimeNanos }
            if (cached != null) return cached.toFix()
        }
        if (timeoutMs <= 0) return null

        // getCurrentLocation can return a cached fix even after an explicit lookup.
        val lookupStarted = SystemClock.elapsedRealtimeNanos()
        val acceptUpdate: ((Location) -> Boolean)? = when {
            fresh -> { fix -> fix.elapsedRealtimeNanos > lookupStarted }
            notBeforeMs != null -> { fix -> fix.time >= notBeforeMs || fix.elapsedRealtimeNanos > lookupStarted }
            else -> null
        }
        if (fused.isNotEmpty()) {
            val fallbackBudget = if (providers.isEmpty()) 0L else
                minOf(TimeUnit.SECONDS.toNanos(10), (deadline - System.nanoTime()).coerceAtLeast(0L) / 2)
            await(lm, fused, precise, deadline - fallbackBudget, acceptUpdate)?.let { return it.toFix() }
        }
        return await(lm, providers, precise, deadline, acceptUpdate)?.toFix()
    }

    fun lastKnown(): LocationFix? {
        val lm = context.getSystemService(LocationManager::class.java) ?: return null
        if (!lm.isLocationEnabled) return null
        return knownLocations(lm, lm.allProviders).maxByOrNull { it.time }?.toFix()
    }

    @SuppressLint("MissingPermission") // Granted by Device Owner when the parent turns location on.
    private fun knownLocations(lm: LocationManager, providers: List<String>): List<Location> =
        providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }

    private class Result(val location: Location?)

    @SuppressLint("MissingPermission")
    private fun await(
        lm: LocationManager,
        providers: List<String>,
        precise: Boolean,
        deadline: Long,
        acceptUpdate: ((Location) -> Boolean)?,
    ): Location? {
        val results = LinkedBlockingQueue<Result>()
        val cancellations = mutableListOf<CancellationSignal>()
        var best: Location? = null
        var pending = 0
        try {
            for ((index, provider) in providers.withIndex()) {
                if (index == 1 && !precise && Build.VERSION.SDK_INT < 31) {
                    // Allow a quick network fix to avoid waking GPS, while leaving time for GPS.
                    val headStart = minOf(TimeUnit.MILLISECONDS.toNanos(500), (deadline - System.nanoTime()) / 2)
                    val network = results.poll(headStart.coerceAtLeast(0L), TimeUnit.NANOSECONDS)
                    if (network != null) {
                        pending--
                        best = network.location
                        if (best != null && best.accuracyOrUnknown() <= PRECISE_ACCURACY_METERS) return best
                    }
                }
                val remaining = deadline - System.nanoTime()
                if (remaining <= 0) break
                val cancel = CancellationSignal()
                cancellations += cancel
                pending++
                val done: (Location?) -> Unit = { results.add(Result(it)) }
                try {
                    when {
                        Build.VERSION.SDK_INT >= 31 -> {
                            val request = LocationRequest.Builder(0L)
                                .setQuality(if (precise) LocationRequest.QUALITY_HIGH_ACCURACY else LocationRequest.QUALITY_LOW_POWER)
                                .setDurationMillis(TimeUnit.NANOSECONDS.toMillis(remaining).coerceAtLeast(1L))
                                .build()
                            if (acceptUpdate == null) {
                                lm.getCurrentLocation(provider, request, cancel, DIRECT_EXECUTOR) { done(it) }
                            } else {
                                requestUpdate(lm, provider, cancel, done, acceptUpdate, request)
                            }
                        }
                        Build.VERSION.SDK_INT >= 30 && acceptUpdate == null ->
                            lm.getCurrentLocation(provider, cancel, DIRECT_EXECUTOR) { done(it) }
                        else -> requestUpdate(lm, provider, cancel, done, acceptUpdate)
                    }
                } catch (e: RuntimeException) {
                    Log.w("Plainphone", "location from $provider failed: ${e.message}")
                    done(null)
                }
            }
            repeat(pending) {
                val remaining = (deadline - System.nanoTime()).coerceAtLeast(0L)
                val result = results.poll(remaining, TimeUnit.NANOSECONDS) ?: return best
                val fix = result.location ?: return@repeat
                if (fix.accuracyOrUnknown() <= PRECISE_ACCURACY_METERS) return fix
                val previous = best
                if (previous == null || fix.accuracyOrUnknown() < previous.accuracyOrUnknown()) best = fix
            }
            return best
        } finally {
            cancellations.forEach { cancel ->
                runCatching { cancel.cancel() }
                    .onFailure { Log.w("Plainphone", "location cancellation failed: ${it.message}") }
            }
        }
    }

    @SuppressLint("MissingPermission")
    private fun requestUpdate(
        lm: LocationManager,
        provider: String,
        cancel: CancellationSignal,
        done: (Location?) -> Unit,
        acceptUpdate: ((Location) -> Boolean)?,
        request: LocationRequest? = null,
    ) {
        val delivered = AtomicBoolean()
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                if (acceptUpdate?.invoke(location) != false && delivered.compareAndSet(false, true)) done(location)
            }
            @Deprecated("Called on Android 10 only; nothing to do.")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) {
                if (delivered.compareAndSet(false, true)) done(null)
            }
        }
        if (Build.VERSION.SDK_INT >= 31 && request != null) {
            cancel.setOnCancelListener { lm.removeUpdates(listener) }
            lm.requestLocationUpdates(provider, request, DIRECT_EXECUTOR, listener)
            return
        }

        val thread = HandlerThread("plainphone-location").apply { start() }
        cancel.setOnCancelListener {
            try {
                lm.removeUpdates(listener)
            } finally {
                thread.quitSafely()
            }
        }
        try {
            if (acceptUpdate != null) {
                lm.requestLocationUpdates(provider, 0L, 0f, listener, thread.looper)
            } else {
                @Suppress("DEPRECATION") // The single-shot API before getCurrentLocation (Android 11).
                lm.requestSingleUpdate(provider, listener, thread.looper)
            }
        } catch (e: RuntimeException) {
            thread.quitSafely()
            throw e
        }
    }

    private fun Location.accuracyOrUnknown() = if (hasAccuracy()) accuracy else Float.POSITIVE_INFINITY

    private fun Location.toFix() = LocationFix(latitude, longitude, if (hasAccuracy()) accuracy else null, time)

    private companion object {
        const val FUSED = "fused"
        val DIRECT_EXECUTOR = Executor { it.run() }
    }
}

/** Runs one sync. Scheduled by [SyncScheduler]. */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val reason = inputData.getString(KEY_REASON) ?: "scheduled"
        val outcome = try {
            Lock.recoverInstall(applicationContext, reason)
            Sync.runner(applicationContext).run(reason)
        } catch (e: Exception) {
            Log.e("Plainphone", "sync crashed", e)
            SyncRunner.Outcome.Failed(e.javaClass.simpleName)
        }
        Log.i("Plainphone", "sync ($reason): $outcome")
        return when (outcome) {
            is SyncRunner.Outcome.Synced -> {
                // #23: once a day, attest the boot state to the server. Never affects the lock.
                runCatching { SyncStore(applicationContext).deviceToken()?.let { AttestationRunner.forContext(applicationContext).runIfDue(it) } }
                // While someone is using the phone, keep the fast cadence (rules and "Find" within a minute).
                // While a ring or an "Are you okay?" is open (pollSeconds 10), also with the screen off.
                val open = outcome.pollSeconds < ServerRules.DEFAULT_POLL_SECONDS
                if (isInteractive(applicationContext) || open) SyncScheduler.soon(applicationContext, outcome.pollSeconds)
                else org.plainphone.app.safety.Safety.scheduleIdlePoll(applicationContext)
                Result.success()
            }
            is SyncRunner.Outcome.Failed -> if (runAttemptCount < 3) Result.retry() else Result.success()
            SyncRunner.Outcome.NotPaired, SyncRunner.Outcome.Removed -> Result.success()
        }
    }

    companion object {
        const val KEY_REASON = "reason"
    }
}

/**
 * Pairs the phone with the enrollment token from the provisioning QR code, in the background, so it
 * also happens when nobody looks at the pairing screen (or the network came late). Scheduled by
 * [SyncScheduler.enrollIfNeeded]; retried with backoff until the token is used or refused.
 */
class EnrollWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val result = try {
            Lock.recoverInstall(applicationContext, "enrollment")
            org.plainphone.app.ui.PairingActivity.controller(applicationContext).enroll()
        } catch (e: Exception) {
            Log.w("Plainphone", "enrollment failed, will retry: ${e.javaClass.simpleName}")
            return Result.retry()
        }
        Log.i("Plainphone", "enrollment: ${result?.javaClass?.simpleName ?: "nothing to do"}")
        if (result is EnrollResult.Paired) {
            SyncScheduler.ensurePeriodic(applicationContext)
            SyncScheduler.now(applicationContext, "paired")
        }
        return Result.success()
    }
}

internal fun isInteractive(context: Context) = context.getSystemService(PowerManager::class.java)?.isInteractive == true

/**
 * When the phone syncs:
 * - every 15 minutes (WorkManager's shortest period), whenever there is a network,
 * - right away after boot, an app update, pairing, the screen turning on and a network change,
 * - every `pollSeconds` (60 s) while the screen is on.
 * Push (FCM) can come later; polling stays the guarantee.
 */
object SyncScheduler {
    private const val PERIODIC = "plainphone-sync-periodic"
    private const val NOW = "plainphone-sync-now"
    private const val SOON = "plainphone-sync-soon"
    private const val ENROLL = "plainphone-enroll"

    private val network = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

    fun ensurePeriodic(context: Context) {
        if (!SyncStore(context).hasStoredPairing) return
        org.plainphone.app.update.UpdateRequestListener.start(context)
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(network)
            .setInputData(workDataOf(SyncWorker.KEY_REASON to "every 15 minutes"))
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun now(context: Context, reason: String) {
        if (!SyncStore(context).hasStoredPairing) return
        org.plainphone.app.update.UpdateRequestListener.start(context)
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(network)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setInputData(workDataOf(SyncWorker.KEY_REASON to reason))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(NOW, ExistingWorkPolicy.KEEP, request)
    }

    fun soon(context: Context, delaySeconds: Int) {
        val request = OneTimeWorkRequestBuilder<SyncWorker>()
            .setConstraints(network)
            .setInitialDelay(delaySeconds.toLong(), TimeUnit.SECONDS)
            .setInputData(workDataOf(SyncWorker.KEY_REASON to "screen on"))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(SOON, ExistingWorkPolicy.REPLACE, request)
    }

    /** Pairs in the background with the QR code's enrollment token, if one is waiting. */
    fun enrollIfNeeded(context: Context) {
        // Light setup redeems in the foreground after Android permissions are granted.
        if (org.plainphone.app.light.Mode.isLight(context)) return
        val store = SyncStore(context)
        if (store.isPaired || store.enrollToken() == null) return
        val request = OneTimeWorkRequestBuilder<EnrollWorker>()
            .setConstraints(network)
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(ENROLL, ExistingWorkPolicy.KEEP, request)
    }

    fun onBoot(context: Context) {
        enrollIfNeeded(context)
        ensurePeriodic(context)
        org.plainphone.app.safety.RingService.restoreVolume(context)
        org.plainphone.app.safety.Safety.scheduleIdlePoll(context)
        now(context, "boot")
    }

    fun stop(context: Context) {
        WorkManager.getInstance(context).apply {
            cancelUniqueWork(PERIODIC)
            cancelUniqueWork(NOW)
            cancelUniqueWork(SOON)
        }
    }
}
