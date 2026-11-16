// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.util.Log
import java.io.IOException
import java.security.MessageDigest

/** The phone-side effects a sync needs. The Android version is [AndroidSyncDevice]; tests use a fake. */
interface SyncDevice {
    fun nowMs(): Long
    fun appVersion(): String
    /** Launchable apps, including the ones Plainphone hid. */
    fun installedApps(): List<InstalledApp>
    /**
     * Re-applies the lock with the stored rules if the merged config changed or the last
     * run is older than [maxAgeMs]. Never during a maintenance unlock.
     */
    fun applyLockIfNeeded(reason: String, maxAgeMs: Long)
    fun lockState(): LockState
    fun battery(): Pair<Int?, Boolean?>
    /** One position, or null if none could be had. [precise] for "Find", coarse for the regular report. */
    fun location(precise: Boolean): LocationFix?
}

data class LockState(
    val deviceOwner: Boolean,
    val maintenance: Boolean,
    val failedPolicies: List<String>,
    val appliedAtMs: Long?,
    val dnsHost: String?,
) {
    /** Every lock policy held and no maintenance unlock is running. */
    val intact: Boolean get() = deviceOwner && !maintenance && failedPolicies.isEmpty() && appliedAtMs != null
}

/**
 * One sync with the server: report apps, fetch rules, apply them, answer "Find", report status.
 *
 * Rule of the house: an error never loosens anything. When the server cannot be reached,
 * answers garbage or says the phone was removed, the last good rules stay in force.
 */
class SyncRunner(
    private val store: SyncStore,
    private val api: SyncApi,
    private val device: SyncDevice,
) {
    sealed interface Outcome {
        data object NotPaired : Outcome
        data object Removed : Outcome
        /** The server could not be reached or answered with an error; try again later. */
        data class Failed(val why: String) : Outcome
        data class Synced(val changed: Boolean, val pollSeconds: Int) : Outcome
    }

    fun run(reason: String): Outcome = synchronized(LOCK) { runLocked(reason) }

    private fun runLocked(reason: String): Outcome {
        if (store.removed) return Outcome.Removed
        val token = store.deviceToken() ?: return Outcome.NotPaired

        // Apps first: a newly installed app then shows up (hidden) in the rules fetched right after.
        guarded("report apps") { reportApps(token) }

        val result = try {
            api.fetchRules(token, store.etag)
        } catch (e: IOException) {
            // Offline or server trouble: keep enforcing the last rules (schedules still advance).
            device.applyLockIfNeeded("sync failed, last rules", APPLY_MAX_AGE_MS)
            return Outcome.Failed(e.message ?: e.javaClass.simpleName)
        }
        val changed = when (result) {
            is RulesResult.Changed -> try {
                store.saveRules(result.etag, result.body, device.nowMs())
                true
            } catch (e: Exception) {
                Log.e(TAG, "rules from the server do not parse; keeping the last good ones", e)
                device.applyLockIfNeeded("bad rules, last rules", APPLY_MAX_AGE_MS)
                return Outcome.Failed("rules do not parse: ${e.message}")
            }
            RulesResult.Unchanged -> {
                store.markSynced(device.nowMs())
                false
            }
            RulesResult.Unpaired -> {
                // Removed in the dashboard. The phone stays locked with its last rules; pairing
                // again needs the maintenance PIN (a Self user could otherwise pair as a child phone).
                store.markRemoved()
                return Outcome.Removed
            }
        }

        device.applyLockIfNeeded(if (changed) "new rules ($reason)" else "sync ($reason)", APPLY_MAX_AGE_MS)
        val rules = store.rules()
        if (rules != null) guarded("report location") { reportLocation(token, rules) }
        guarded("report status") { reportStatus(token) }
        return Outcome.Synced(changed, rules?.pollSeconds ?: ServerRules.DEFAULT_POLL_SECONDS)
    }

    private fun reportApps(token: String) {
        val apps = device.installedApps().sortedBy { it.packageName }
        val hash = sha256(apps.joinToString("\n") { "${it.packageName}\t${it.label}\t${it.core}" })
        if (hash == store.appsHash) return
        api.reportApps(token, apps)
        store.appsHash = hash
    }

    private fun reportLocation(token: String, rules: ServerRules) {
        if (!rules.locationEnabled) return
        val now = device.nowMs()
        val requested = rules.locateRequestedAt?.toEpochMilli()
        val find = requested != null && requested != store.answeredLocateMs
        val due = now - store.locationAtMs >= rules.locationIntervalMinutes * 60_000L
        if (!find && !due) return
        val fix = device.location(precise = find)
        if (fix == null) {
            Log.w(TAG, "no position available")
            return
        }
        api.reportLocation(token, fix)
        store.locationAtMs = now
        if (find) store.answeredLocateMs = requested!!
    }

    private fun reportStatus(token: String) {
        val lock = device.lockState()
        val (battery, charging) = device.battery()
        val status = DeviceStatus(
            appVersion = device.appVersion(),
            batteryPct = battery,
            charging = charging,
            deviceOwner = lock.deviceOwner,
            lockIntact = lock.intact,
            maintenance = lock.maintenance,
            failedPolicies = lock.failedPolicies,
            rulesEtag = store.etag,
            rulesAppliedAtMs = lock.appliedAtMs,
            dnsHost = lock.dnsHost,
        )
        // Battery changes all the time: send at once when something about the lock changed, else every 15 min.
        val hash = sha256(status.copy(batteryPct = null, charging = null, rulesAppliedAtMs = null).toString())
        val now = device.nowMs()
        if (hash == store.statusHash && now - store.statusAtMs < STATUS_EVERY_MS) return
        api.reportStatus(token, status)
        store.statusHash = hash
        store.statusAtMs = now
    }

    private inline fun guarded(what: String, block: () -> Unit) {
        try {
            block()
        } catch (e: Exception) {
            Log.w(TAG, "$what failed: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "Plainphone"
        private val LOCK = Any()
        /** The lock is re-applied at least this often, so a change on the phone heals itself. */
        const val APPLY_MAX_AGE_MS = 15 * 60_000L
        const val STATUS_EVERY_MS = 15 * 60_000L

        fun sha256(text: String): String =
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
