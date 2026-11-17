// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings

/** Durable, process-scoped windows in which Device Owner installs may get through. */
class InstallLease(
    private val store: Store,
    private val env: Env,
    private val relockNow: (() -> Unit)? = null,
    private val restrictionLifted: () -> Boolean = { false },
    private val tracksOverruns: () -> Boolean = { false },
    private val onRecovered: (Boolean) -> Unit = {},
    /** Opens the restriction through the normal policy path. */
    private val applyLock: (reason: String, catalogChanged: Boolean) -> Unit,
) {
    data class Lease(
        val untilMs: Long,
        val bootCount: Int,
        val versionCode: Long,
        val process: String,
        val sessionId: Int? = null,
        val wallDeadlineMs: Long? = null,
        val invalidated: Boolean = false,
    )

    interface Store {
        fun load(): Map<String, Lease>
        fun save(leases: Map<String, Lease>)
        fun retire(leases: Map<String, Lease>, overrunSeconds: Long?) = save(leases)
    }

    interface Env {
        fun nowMs(): Long
        fun wallNowMs(): Long = System.currentTimeMillis()
        fun bootCount(): Int
        fun processId(): String
        fun versionCode(): Long
        fun prepareExpiry(holder: String, atMs: Long) = Unit
        /** Wakes the app at [atMs] to apply the lock in case the holder never comes back. */
        fun scheduleExpiry(holder: String, atMs: Long)
        fun cancelExpiry(holder: String) = Unit
        fun persistWithWatchdog(holder: String, atMs: Long, persist: () -> Unit) = persist()
    }

    fun allowsInstall(catalogApproved: Boolean): Boolean {
        val open = valid()
        return SELF_UPDATE in open || (catalogApproved && CATALOG in open)
    }

    /** Keeps the durable marker until Android has finished the restriction clear. */
    fun clearIfAllowed(catalogApproved: Boolean, clear: () -> Unit): Boolean {
        synchronized(LOCK) {
            if (!allowsInstall(catalogApproved)) return false
            clearsInFlight++
        }
        try {
            clear()
        } finally {
            synchronized(LOCK) { clearsInFlight-- }
            recover()
        }
        return true
    }

    /**
     * Runs session creation in a lease. A session that returns after expiry must be abandoned;
     * recovery is also scheduled independently of this call.
     */
    fun <T> hold(holder: String, durationMs: Long = MAX_MS, block: () -> T): T {
        try {
            acquire(holder, durationMs)
            check(isOpen(holder)) { "Install window expired before session creation" }
            val result = block()
            check(isOpen(holder)) { "Install window expired during session creation" }
            return result
        } finally {
            release(holder)
        }
    }

    fun acquire(holder: String, durationMs: Long) {
        begin(holder, durationMs)
        applyLock("install lease opened: $holder", holder == CATALOG)
    }

    fun begin(holder: String, durationMs: Long) {
        val duration = durationMs.coerceIn(1L, MAX_MS)
        val until = env.nowMs() + duration
        val wallDeadline = env.wallNowMs() + duration
        synchronized(BEGIN_LOCK) {
            env.prepareExpiry(holder, until)
            env.persistWithWatchdog(holder, until) {
                val lease = Lease(until, env.bootCount(), env.versionCode(), env.processId(), wallDeadlineMs = wallDeadline)
                synchronized(LOCK) {
                    check(until > env.nowMs()) { "Install watchdog started after its deadline" }
                    val previous = store.load()
                    check(clearsInFlight == 0 || holder !in previous) {
                        "Install restriction clear still in progress"
                    }
                    try {
                        store.save(previous + (holder to lease))
                        env.scheduleExpiry(holder, until)
                    } catch (e: Exception) {
                        // SharedPreferences updates its in-memory view even when commit fails.
                        runCatching { store.save(previous) }
                        throw e
                    }
                }
            }
        }
    }

    fun isOpen(holder: String): Boolean = holder in valid()

    fun finishSession(sessionId: Int) {
        synchronized(LOCK) {
            if (store.load()[SELF_UPDATE]?.sessionId != sessionId) return
            invalidate(SELF_UPDATE)
        }
        recover("self-update installer result")
    }

    /** Relock first. Keep the recovery markers if Android rejects the policy write. */
    fun recover(reason: String = "recover install restriction", force: Boolean = false) {
        val catalogChanged = synchronized(LOCK) {
            val current = store.load()
            val valid = if (force) emptyMap() else valid(current)
            val expired = current.keys - valid.keys
            if (expired.isEmpty() && (valid.isNotEmpty() || !restrictionLifted())) return
            // A failed diagnostic read must not prevent recovery of a retired lease.
            val wasLifted = expired.isNotEmpty() && valid.isEmpty() && runCatching(restrictionLifted).getOrDefault(false)
            if (relockNow == null) {
                applyLock(reason, CATALOG in expired)
            } else if (valid.isEmpty()) {
                relockNow.invoke()
            }
            if (expired.isNotEmpty()) {
                val overrun = if (valid.isEmpty() && tracksOverruns()) {
                    expired.mapNotNull { overrunMs(current.getValue(it), wasLifted) }.maxOrNull()
                } else {
                    null
                }
                // A clear can take effect after the watchdog relocks. Keep its deadline
                // available to the policy path, while making the expired lease unusable.
                val retained = if (clearsInFlight == 0) emptyMap() else
                    current.filterKeys { it in expired }.mapValues { (_, lease) -> lease.copy(invalidated = true) }
                store.retire(valid + retained, overrun?.let { (it + 999) / 1_000 })
                val retired = expired - retained.keys
                retired.forEach(env::cancelExpiry)
                CATALOG in retired
            } else {
                false
            }
        }
        onRecovered(catalogChanged)
    }

    fun hasMarkers(): Boolean = store.load().isNotEmpty()

    /** Drops [holder]'s lease and applies the lock; the restriction returns unless another lease is open. */
    fun release(holder: String) {
        try {
            invalidate(holder)
        } finally {
            recover()
        }
    }

    fun invalidate(holder: String): Boolean = synchronized(LOCK) {
        val current = store.load()
        val lease = current[holder] ?: return@synchronized false
        // Persist an invalid marker until the restriction has been reapplied.
        store.save(current + (holder to lease.copy(invalidated = true)))
        true
    }

    private fun overrunMs(lease: Lease, wasLifted: Boolean): Long? {
        if (lease.untilMs <= 0) return null // older builds used zero for a released lease
        val sameBoot = lease.bootCount == env.bootCount()
        val lateBy = if (sameBoot) {
            env.nowMs() - lease.untilMs
        } else {
            // A legacy deadline belongs to the previous boot's monotonic clock.
            lease.wallDeadlineMs?.let { env.wallNowMs() - it } ?: 0L
        }
        val startedAgain = !sameBoot || lease.process != env.processId()
        return lateBy.takeIf {
            (wasLifted && it > OVERRUN_GRACE_MS) || (startedAgain && it >= 0 && (wasLifted || !lease.invalidated))
        }
    }

    private fun valid(leases: Map<String, Lease> = store.load()): Map<String, Lease> {
        if (leases.isEmpty()) return leases
        val now = env.nowMs()
        val process = env.processId()
        return leases.filterValues { lease ->
            !lease.invalidated && lease.untilMs > now && lease.untilMs - now <= MAX_MS && lease.process == process &&
                lease.bootCount == env.bootCount() && lease.versionCode == env.versionCode()
        }
    }

    companion object {
        const val SELF_UPDATE = "self-update"
        const val CATALOG = "catalog"
        const val MAX_MS = 15 * 60_000L
        private const val OVERRUN_GRACE_MS = 30_000L
        private val LOCK = Any()
        private var clearsInFlight = 0
        private val BEGIN_LOCK = Any()

        internal fun latestOverrun(context: Context): InstallWindowOverrun? = PrefsLeaseStore(context).latestOverrun()

        /** Binds the durable leases to the Device Owner restriction and recovery entry points. */
        fun android(context: Context): InstallLease {
            val app = context.applicationContext
            val device = org.plainphone.app.AndroidDeviceControls(app)
            val restriction = android.os.UserManager.DISALLOW_INSTALL_APPS
            val lock = org.plainphone.app.Lock
            return InstallLease(
                PrefsLeaseStore(app),
                AndroidLeaseEnv(app),
                relockNow = {
                    if (!lock.isInMaintenanceWindow(app) && device.isDeviceOwner()) {
                        device.addRestriction(restriction)
                    }
                },
                restrictionLifted = {
                    val sync = org.plainphone.app.sync.SyncStore(app)
                    !lock.isInMaintenanceWindow(app) && !sync.released && !sync.releaseAsked &&
                        device.isDeviceOwner() &&
                        !app.getSystemService(android.os.UserManager::class.java).hasUserRestriction(restriction)
                },
                tracksOverruns = {
                    val sync = org.plainphone.app.sync.SyncStore(app)
                    org.plainphone.app.light.Mode.isStrong(app) && device.isDeviceOwner() &&
                        !lock.isInMaintenanceWindow(app) && !sync.released && !sync.releaseAsked
                },
                onRecovered = { catalogChanged ->
                    InstallWatchdogService.finished()
                    if (catalogChanged && !lock.isInMaintenanceWindow(app)) {
                        lock.applyIfNeededAsync(app, "catalog install window ended") {}
                    }
                },
            ) { reason, catalogChanged -> lock.applyForInstall(app, reason, catalogChanged) }
        }
    }
}

internal data class InstallWindowOverrun(val seconds: Long, val sequence: Long)

private class PrefsLeaseStore(context: Context) : InstallLease.Store {
    private val prefs = context.getSharedPreferences("plainphone_install_lease", Context.MODE_PRIVATE)

    override fun load(): Map<String, InstallLease.Lease> = prefs.all.mapNotNull { (holder, raw) ->
        if (holder == OVERRUN) return@mapNotNull null
        val parts = (raw as? String)?.split(',') ?: return@mapNotNull null
        val lease = runCatching {
            InstallLease.Lease(
                parts[0].toLong(), parts[1].toInt(), parts[2].toLong(), parts[3],
                parts.getOrNull(4)?.toIntOrNull(), parts.getOrNull(5)?.toLongOrNull(),
                parts.getOrNull(6) == "true",
            )
        }.getOrNull()
        lease?.let { holder to it }
    }.toMap()

    fun latestOverrun(): InstallWindowOverrun? {
        val parts = prefs.getString(OVERRUN, null)?.split(',') ?: return null
        val seconds = parts.getOrNull(0)?.toLongOrNull() ?: return null
        val sequence = parts.getOrNull(1)?.toLongOrNull() ?: return null
        return InstallWindowOverrun(seconds, sequence)
    }

    override fun save(leases: Map<String, InstallLease.Lease>) = retire(leases, null)

    // commit, not apply: the lease must be on disk before the restriction is lifted.
    @SuppressLint("ApplySharedPref")
    override fun retire(leases: Map<String, InstallLease.Lease>, overrunSeconds: Long?) {
        val edit = prefs.edit()
        (load().keys - leases.keys).forEach(edit::remove)
        leases.forEach { (holder, l) ->
            edit.putString(holder, listOf(l.untilMs, l.bootCount, l.versionCode, l.process,
                l.sessionId ?: "", l.wallDeadlineMs ?: "", l.invalidated).joinToString(","))
        }
        if (overrunSeconds != null) {
            val sequence = (latestOverrun()?.sequence ?: 0) + 1
            edit.putString(OVERRUN, "$overrunSeconds,$sequence")
        }
        check(edit.commit()) { "Could not persist install leases" }
    }

    companion object {
        private const val OVERRUN = "last_overrun"
    }
}

internal class AndroidLeaseEnv(private val context: Context) : InstallLease.Env {
    override fun nowMs() = android.os.SystemClock.elapsedRealtime()
    override fun processId() = process

    // Elapsed time is monotonic within a boot. A reboot needs the persisted wall deadline.
    override fun bootCount(): Int = runCatching {
        Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, 0)
    }.getOrDefault(0)
    override fun versionCode(): Long = 0

    companion object {
        private val process = java.util.UUID.randomUUID().toString()
    }

    override fun prepareExpiry(holder: String, atMs: Long) {
        if (org.plainphone.app.light.Mode.isStrong(context)) {
            check(InstallWatchdogService.hasBatteryExemption(context)) {
                "Plainphone needs a battery exemption to keep the install deadline in Doze"
            }
        }
        InstallRecoveryWorker.schedule(context, holder, (atMs - nowMs()).coerceAtLeast(0))
    }

    override fun scheduleExpiry(holder: String, atMs: Long) {
        UpdateReceiver.scheduleLeaseExpiry(context, holder, atMs)
    }

    override fun cancelExpiry(holder: String) {
        UpdateReceiver.cancelLeaseExpiry(context, holder)
    }

    override fun persistWithWatchdog(holder: String, atMs: Long, persist: () -> Unit) {
        if (org.plainphone.app.light.Mode.isStrong(context)) {
            InstallWatchdogService.armed(context, holder, atMs, persist)
        } else {
            persist()
        }
    }
}
