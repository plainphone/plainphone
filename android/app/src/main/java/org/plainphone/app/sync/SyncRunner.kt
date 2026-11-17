// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.util.Log
import java.io.IOException
import java.security.MessageDigest
import org.plainphone.app.StepResult

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
    /**
     * Switches Plainphone off for good, as the maintenance screen's release does (strong mode:
     * Device Owner given up; light mode: device admin, VPN and guard off), after cancelling any
     * relock. Blocking. Every step that did not hold is in the list as a failure.
     */
    fun release(): List<StepResult>
    /** One position, or null if none could be had. [precise] for "Find", coarse for the regular report. */
    fun location(precise: Boolean): LocationFix?
    /** Minutes used today per limited app ("*" = total), or null without time limits. */
    fun timeUsed(): Map<String, Int>? = null

    // "Ring the phone", "Are you okay?" and the location notices (docs/location.md).
    // Defaults do nothing, so a device without a screen (tests) needs none of it.

    /** Starts or stops the ring, shows or closes the question, and keeps the location notices current. */
    fun onSafetyRules(rules: ServerRules) {}
    /** Answers and "shown" events the server has not heard yet, oldest first. */
    fun pendingSafetyEvents(): List<SafetyEvent> = emptyList()
    fun safetyEventDone(event: SafetyEvent) {}
    /** The child answered this "Are you okay?" on the phone (the server may not know yet). */
    fun checkInAnswered(id: String): Boolean = false
    /** A single position went to the parent; the phone says so ([why] is "find" or "checkin"). */
    fun positionSent(why: String) {}
}

/** Something the child did with a ring or an "Are you okay?", waiting to be sent. */
data class SafetyEvent(val requestId: String, val event: String)

data class LockState(
    /** "strong" (Device Owner) or "light" (an ordinary app with the guard and the VPN). */
    val mode: String = "strong",
    /** What protects the phone right now (light mode's checklist; also sent in strong mode). */
    val protections: Map<String, Boolean>? = null,
    val deviceOwner: Boolean,
    val maintenance: Boolean,
    val failedPolicies: List<String>,
    val appliedAtMs: Long?,
    val dnsHost: String?,
) {
    /**
     * Every lock policy held and no maintenance unlock is running. In light mode every protection
     * is a lock step, so a missing one is a failed policy.
     */
    val intact: Boolean get() = (deviceOwner || mode == "light") && !maintenance && failedPolicies.isEmpty() && appliedAtMs != null
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

        // Released already: Plainphone is off, so the lock is never applied again. Only the
        // server still has to be told (it may have been unreachable the last time).
        if (store.released) acknowledgeRelease(token)?.let { return it }

        // Apps first: a newly installed app then shows up (hidden) in the rules fetched right after.
        guarded("report apps") { reportApps(token) }

        val result = try {
            api.fetchRules(token, store.etag)
        } catch (e: IOException) {
            // A release that did not finish last time is finished offline too.
            releaseIfAsked(token)?.let { return it }
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
                releaseIfAsked(token)?.let { return it }
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
                // Its DNS ClientID is deleted with it: switch back to the QR code's host right away.
                device.applyLockIfNeeded("removed in the dashboard", APPLY_MAX_AGE_MS)
                return Outcome.Removed
            }
        }

        // Before the lock: a released phone must never be locked again.
        releaseIfAsked(token)?.let { return it }

        device.applyLockIfNeeded(if (changed) "new rules ($reason)" else "sync ($reason)", APPLY_MAX_AGE_MS)
        val rules = store.rules()
        // Answers first: an "I'm okay" sent now means no position is owed for that check-in.
        guarded("report safety events") { reportSafetyEvents(token) }
        if (rules != null) guarded("ring and check-in") { device.onSafetyRules(rules) }
        if (rules != null) guarded("report location") { reportLocation(token, rules) }
        guarded("report status") { reportStatus(token) }
        return Outcome.Synced(changed, rules?.pollSeconds ?: ServerRules.DEFAULT_POLL_SECONDS)
    }

    /**
     * The parents released the phone (`release` in the rules). Switches Plainphone off, remembers it,
     * and tells the server. Returns null when no release was asked for. A release that did not hold
     * is not acknowledged (the parent keeps seeing "Releasing") and is tried again at the next sync;
     * nothing is reported to the parent meanwhile, since they asked for the protection to go.
     */
    private fun releaseIfAsked(token: String): Outcome? {
        if (!store.releaseAsked) return null
        val results = try {
            device.release()
        } catch (e: Exception) {
            Log.e(TAG, "release crashed", e)
            listOf(StepResult("release", false, "${e.javaClass.simpleName}: ${e.message}"))
        }
        val failed = results.filterNot { it.ok }
        if (failed.isNotEmpty()) {
            Log.w(TAG, "release did not hold, trying again at the next sync: ${failed.joinToString()}")
            return Outcome.Failed("release did not hold: ${failed.joinToString { it.name }}")
        }
        store.markReleased()
        return acknowledgeRelease(token) ?: Outcome.Failed("the server says nobody asked for a release")
    }

    /**
     * Tells the server Plainphone is off. Done, or a phone the server no longer knows, ends the sync
     * as [Outcome.Removed]. A network error keeps the release for the next sync. Null means the server
     * says nobody asked for a release: the release is forgotten and the sync goes on with the real rules.
     */
    private fun acknowledgeRelease(token: String): Outcome? {
        val done = try {
            api.ackReleased(token)
        } catch (e: IOException) {
            return Outcome.Failed("release not acknowledged yet: ${e.message ?: e.javaClass.simpleName}")
        }
        if (done) {
            store.markRemoved()
            return Outcome.Removed
        }
        store.clearReleased()
        return null
    }

    private fun reportApps(token: String) {
        val apps = device.installedApps().sortedBy { it.packageName }
        val hash = sha256(apps.joinToString("\n") { "${it.packageName}\t${it.label}\t${it.core}" })
        if (hash == store.appsHash) return
        api.reportApps(token, apps)
        store.appsHash = hash
    }

    private fun reportSafetyEvents(token: String) {
        for (e in device.pendingSafetyEvents()) {
            // Sent, or refused for good (unknown request): either way it is done. Network errors throw and retry later.
            api.reportSafety(token, e.requestId, e.event)
            device.safetyEventDone(e)
        }
    }

    private fun reportLocation(token: String, rules: ServerRules) {
        if (!rules.locationEnabled || rules.locationMode == ServerRules.LOCATION_OFF) return
        val now = device.nowMs()
        val requested = rules.locateRequestedAt?.toEpochMilli()
        // A Find nobody can answer with a fresh fix (indoors, no GPS) is given up after a while,
        // so the phone does not burn its battery on precise attempts every minute.
        val find = requested != null && requested != store.answeredLocateMs && now - requested < FIND_RETRY_MS
        // "Are you okay?" without an answer by the deadline: one position, once.
        val c = rules.checkIn
        val checkIn = c != null && c.sendLocation && now >= c.deadline.toEpochMilli() &&
            c.id != store.locatedCheckInId && !device.checkInAnswered(c.id)
        // "always" ends at alwaysUntil even if the phone has not heard from the server since.
        val due = rules.locationMode == ServerRules.LOCATION_ALWAYS &&
            (rules.locationAlwaysUntil == null || now < rules.locationAlwaysUntil.toEpochMilli()) &&
            now - store.locationAtMs >= rules.locationIntervalMinutes * 60_000L
        if (!find && !checkIn && !due) return
        val fix = device.location(precise = find || checkIn)
        if (fix == null) {
            Log.w(TAG, "no position available")
            return
        }
        val stored = api.reportLocation(token, fix)
        store.locationAtMs = now
        if (checkIn) store.locatedCheckInId = c.id
        // Only a fix taken after the parent pressed Find answers it (the server and dashboard
        // compare the same way). An older last-known position is sent, but the phone keeps trying.
        if (find && fix.recordedAtMs >= requested) store.answeredLocateMs = requested
        // Every position goes to the phone's own log; single ones also get a notice
        // ("always" has its own ongoing one).
        // One Find is one line and one notice, however many retries it takes to get a fresh fix.
        if (!stored) return
        when {
            checkIn -> device.positionSent("checkin")
            find -> if (store.shownLocateMs != requested) {
                store.shownLocateMs = requested
                device.positionSent("find")
            }
            else -> device.positionSent("always")
        }
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
            mode = lock.mode,
            protections = lock.protections,
            timeUsed = device.timeUsed(),
        )
        // Battery changes all the time: send at once when something about the lock changed, else every 15 min.
        // Minutes used change every minute too: they ride along, but do not force a report.
        val hash = sha256(status.copy(batteryPct = null, charging = null, rulesAppliedAtMs = null, timeUsed = null).toString())
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
        const val FIND_RETRY_MS = 30 * 60_000L

        fun sha256(text: String): String =
            MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
