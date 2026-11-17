// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.annotation.SuppressLint
import android.content.Context

/** Durable, process-scoped windows in which Device Owner installs may get through. */
class InstallLease(
    private val store: Store,
    private val env: Env,
    private val relockNow: (() -> Unit)? = null,
    private val restrictionLifted: () -> Boolean = { false },
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
    )

    interface Store {
        fun load(): Map<String, Lease>
        fun save(leases: Map<String, Lease>)
    }

    interface Env {
        fun nowMs(): Long
        fun bootCount(): Int
        fun processId(): String
        fun versionCode(): Long
        /** Wakes the app at [atMs] to apply the lock in case the holder never comes back. */
        fun scheduleExpiry(holder: String, atMs: Long)
        fun persistWithWatchdog(holder: String, atMs: Long, persist: () -> Unit) = persist()
    }

    fun allowsInstall(catalogApproved: Boolean): Boolean {
        val open = valid()
        return SELF_UPDATE in open || (catalogApproved && CATALOG in open)
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
        val until = env.nowMs() + durationMs.coerceIn(1L, MAX_MS)
        synchronized(BEGIN_LOCK) {
            env.scheduleExpiry(holder, until)
            env.persistWithWatchdog(holder, until) {
                val lease = Lease(until, env.bootCount(), env.versionCode(), env.processId())
                synchronized(LOCK) {
                    check(until > env.nowMs()) { "Install watchdog started after its deadline" }
                    val previous = store.load()
                    try {
                        store.save(previous + (holder to lease))
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
            if (relockNow == null) {
                applyLock(reason, CATALOG in expired)
            } else if (valid.isEmpty()) {
                relockNow.invoke()
            }
            if (expired.isNotEmpty()) store.save(valid)
            CATALOG in expired
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
        store.save(current + (holder to lease.copy(untilMs = 0)))
        true
    }

    private fun valid(leases: Map<String, Lease> = store.load()): Map<String, Lease> {
        if (leases.isEmpty()) return leases
        val now = env.nowMs()
        val process = env.processId()
        return leases.filterValues { lease ->
            lease.untilMs > now && lease.untilMs - now <= MAX_MS && lease.process == process &&
                lease.bootCount == env.bootCount() && lease.versionCode == env.versionCode()
        }
    }

    companion object {
        const val SELF_UPDATE = "self-update"
        const val CATALOG = "catalog"
        const val MAX_MS = 15 * 60_000L
        private val LOCK = Any()
        private val BEGIN_LOCK = Any()

        // Keep an in-flight policy clear from racing the watchdog's add. This lock never
        // covers PackageInstaller or the other policy steps.
        internal fun <T> withRestrictionLock(block: () -> T): T = synchronized(LOCK, block)

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

private class PrefsLeaseStore(context: Context) : InstallLease.Store {
    private val prefs = context.getSharedPreferences("plainphone_install_lease", Context.MODE_PRIVATE)

    override fun load(): Map<String, InstallLease.Lease> = prefs.all.mapNotNull { (holder, raw) ->
        val parts = (raw as? String)?.split(',') ?: return@mapNotNull null
        val lease = runCatching {
            InstallLease.Lease(parts[0].toLong(), parts[1].toInt(), parts[2].toLong(), parts[3], parts.getOrNull(4)?.toIntOrNull())
        }.getOrNull()
        lease?.let { holder to it }
    }.toMap()

    // commit, not apply: the lease must be on disk before the restriction is lifted.
    @SuppressLint("ApplySharedPref")
    override fun save(leases: Map<String, InstallLease.Lease>) {
        val edit = prefs.edit().clear()
        leases.forEach { (holder, l) -> edit.putString(holder, "${l.untilMs},${l.bootCount},${l.versionCode},${l.process},${l.sessionId ?: ""}") }
        check(edit.commit()) { "Could not persist install leases" }
    }
}

private class AndroidLeaseEnv(private val context: Context) : InstallLease.Env {
    override fun nowMs() = android.os.SystemClock.elapsedRealtime()
    override fun processId() = process

    // The persisted fields are retained for older records. In Android a process token
    // already changes on reboot and replacement; avoid system calls during recovery.
    override fun bootCount(): Int = 0
    override fun versionCode(): Long = 0

    companion object {
        private val process = java.util.UUID.randomUUID().toString()
    }

    override fun scheduleExpiry(holder: String, atMs: Long) {
        UpdateReceiver.scheduleLeaseExpiry(context, holder, atMs)
        InstallRecoveryWorker.schedule(context, holder, (atMs - nowMs()).coerceAtLeast(0))
    }

    override fun persistWithWatchdog(holder: String, atMs: Long, persist: () -> Unit) {
        if (org.plainphone.app.light.Mode.isStrong(context)) {
            InstallWatchdogService.armed(context, holder, atMs, persist)
        } else {
            persist()
        }
    }
}
