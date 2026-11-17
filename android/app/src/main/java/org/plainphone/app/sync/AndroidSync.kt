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
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.plainphone.app.Compat
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.PrefsHiddenAppsStore
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.update.PrefsUpdateStateStore
import org.plainphone.app.update.SelfUpdate

/** Entry points for the rest of the app. */
object Sync {
    fun runner(context: Context): SyncRunner {
        val app = context.applicationContext
        return SyncRunner(SyncStore(app), PlainphoneApi(ConfigStore(app).load().serverUrl), AndroidSyncDevice(app))
    }
}

/** Real phone effects for [SyncRunner]. */
class AndroidSyncDevice(private val context: Context) : SyncDevice {
    override fun nowMs() = System.currentTimeMillis()

    override fun appVersion(): String =
        context.packageManager.getPackageInfo(context.packageName, 0).versionName ?: "?"

    override fun installedApps(): List<InstalledApp> {
        val pm = context.packageManager
        val controls = AndroidDeviceControls(context)
        val core = controls.corePackages()
        // Hidden apps do not show up in the launcher query; add the ones Plainphone hid.
        val packages = controls.launchablePackages() + PrefsHiddenAppsStore(context).load().filter(controls::isInstalled)
        return packages.filter { it != context.packageName }.map { pkg ->
            val label = runCatching {
                val info = Compat.applicationInfo(pm, pkg, PackageManager.MATCH_UNINSTALLED_PACKAGES)
                pm.getApplicationLabel(info).toString()
            }.getOrNull()?.trim()?.takeIf { it.isNotEmpty() } ?: pkg
            InstalledApp(pkg, label, core = pkg in core && !isMakerTelephonyApp(pkg))
        }
    }

    /**
     * The maker's phone and SMS apps are never reported as core: Plainphone hides them whatever
     * the dashboard says (approved contacts), and the parent should see them as hidden.
     */
    private fun isMakerTelephonyApp(pkg: String): Boolean {
        val apps = AndroidDeviceControls(context).telephonyApps()
        return pkg != apps.systemDialer && (pkg in apps.dialers || pkg in apps.smsApps)
    }

    override fun applyLockIfNeeded(reason: String, maxAgeMs: Long) {
        Lock.applyIfNeeded(context, reason, maxAgeMs)
    }

    override fun lockState(): LockState = Lock.lockState(context)

    override fun battery(): Pair<Int?, Boolean?> {
        val bm = context.getSystemService(BatteryManager::class.java) ?: return null to null
        val pct = bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY).takeIf { it in 0..100 }
        val sticky = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
        val plugged = sticky?.getIntExtra(BatteryManager.EXTRA_PLUGGED, -1)
        return pct to plugged?.takeIf { it >= 0 }?.let { it != 0 }
    }

    override fun location(precise: Boolean): LocationFix? = LocationReader(context).current(precise)

    override fun appVersionCode(): Long =
        Compat.packageInfo(context.packageManager, context.packageName, 0).longVersionCode

    override fun updateReport() = SelfUpdate.report(context)

    override fun requestUpdate(requestedAtMs: Long) {
        val store = PrefsUpdateStateStore(context)
        if (requestedAtMs <= store.handledRequestMs) return
        store.handledRequestMs = requestedAtMs
        SelfUpdate.now(context)
    }
}

/**
 * One position via the platform's location service. The platform "fused" provider is used when
 * the phone has one (on phones with Google Play services it is backed by Google's fused location),
 * otherwise GPS or the network provider. No Play services library: the app stays free of it.
 */
class LocationReader(private val context: Context) {

    @SuppressLint("MissingPermission") // Granted by Device Owner when the parent turns location on.
    fun current(precise: Boolean, timeoutMs: Long = 30_000L): LocationFix? {
        val lm = context.getSystemService(LocationManager::class.java) ?: return null
        if (!lm.isLocationEnabled) return null
        val known = lm.allProviders.toSet()
        val providers = buildList {
            // LocationManager.FUSED_PROVIDER is public from Android 12; older versions do not list it in allProviders.
            if (FUSED in known) add(FUSED)
            if (precise) add(LocationManager.GPS_PROVIDER)
            add(LocationManager.NETWORK_PROVIDER)
            if (!precise) add(LocationManager.GPS_PROVIDER)
        }.filter { it in known && lm.isProviderEnabled(it) }
        for (provider in providers) {
            val fresh = runCatching { await(lm, provider, precise, timeoutMs) }
                .onFailure { Log.w("Plainphone", "location from $provider failed: ${it.message}") }
                .getOrNull()
            if (fresh != null) return fresh.toFix()
        }
        // Last resort: the newest known position, with its real time so the parent sees its age.
        return providers.mapNotNull { runCatching { lm.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
            ?.toFix()
    }

    @SuppressLint("MissingPermission")
    private fun await(lm: LocationManager, provider: String, precise: Boolean, timeoutMs: Long): Location? {
        val latch = CountDownLatch(1)
        var result: Location? = null
        val cancel = CancellationSignal()
        val executor = Executors.newSingleThreadExecutor()
        val done = { loc: Location? -> result = loc; latch.countDown() }
        try {
            when {
                Build.VERSION.SDK_INT >= 31 -> {
                    val request = LocationRequest.Builder(0L)
                        .setQuality(if (precise) LocationRequest.QUALITY_HIGH_ACCURACY else LocationRequest.QUALITY_BALANCED_POWER_ACCURACY)
                        .setDurationMillis(timeoutMs)
                        .build()
                    lm.getCurrentLocation(provider, request, cancel, executor) { done(it) }
                }
                // Android 11: same call without the request; the provider decides accuracy.
                Build.VERSION.SDK_INT >= 30 -> lm.getCurrentLocation(provider, cancel, executor) { done(it) }
                else -> requestSingleUpdate(lm, provider, cancel, done)
            }
            if (!latch.await(timeoutMs + 2_000L, TimeUnit.MILLISECONDS)) cancel.cancel()
        } finally {
            executor.shutdown()
        }
        return result
    }

    /** Android 10: one update via a listener on its own looper thread, removed on cancel or after the first fix. */
    @SuppressLint("MissingPermission")
    private fun requestSingleUpdate(lm: LocationManager, provider: String, cancel: CancellationSignal, done: (Location?) -> Unit) {
        val thread = HandlerThread("plainphone-location").apply { start() }
        val listener = object : LocationListener {
            override fun onLocationChanged(location: Location) {
                done(location)
                lm.removeUpdates(this)
                thread.quitSafely()
            }
            @Deprecated("Called on Android 10 only; nothing to do.")
            override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) = Unit
            override fun onProviderEnabled(provider: String) = Unit
            override fun onProviderDisabled(provider: String) = Unit
        }
        cancel.setOnCancelListener {
            lm.removeUpdates(listener)
            thread.quitSafely()
        }
        try {
            @Suppress("DEPRECATION") // The single-shot API before getCurrentLocation (Android 11).
            lm.requestSingleUpdate(provider, listener, thread.looper)
        } catch (e: RuntimeException) {
            thread.quitSafely()
            throw e
        }
    }

    private fun Location.toFix() = LocationFix(latitude, longitude, if (hasAccuracy()) accuracy else null, time)

    private companion object {
        const val FUSED = "fused"
    }
}

/** Runs one sync. Scheduled by [SyncScheduler]. */
class SyncWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val reason = inputData.getString(KEY_REASON) ?: "scheduled"
        val outcome = try {
            Sync.runner(applicationContext).run(reason)
        } catch (e: Exception) {
            Log.e("Plainphone", "sync crashed", e)
            SyncRunner.Outcome.Failed(e.javaClass.simpleName)
        }
        Log.i("Plainphone", "sync ($reason): $outcome")
        return when (outcome) {
            is SyncRunner.Outcome.Synced -> {
                // While someone is using the phone, keep the fast cadence (rules and "Find" within a minute).
                if (isInteractive(applicationContext)) SyncScheduler.soon(applicationContext, outcome.pollSeconds)
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
        // Updates do not need pairing: an unpaired phone still gets fixes from the default server.
        SelfUpdate.ensurePeriodic(context)
        if (!SyncStore(context).isPaired) return
        val request = PeriodicWorkRequestBuilder<SyncWorker>(15, TimeUnit.MINUTES)
            .setConstraints(network)
            .setInputData(workDataOf(SyncWorker.KEY_REASON to "every 15 minutes"))
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(PERIODIC, ExistingPeriodicWorkPolicy.KEEP, request)
    }

    fun now(context: Context, reason: String) {
        if (!SyncStore(context).isPaired) return
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
