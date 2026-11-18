// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.annotation.SuppressLint
import android.content.Context
import android.provider.Settings
import java.util.UUID

/**
 * Lease states under LOCK: absent → open → closing → absent.
 * A clear can run outside LOCK. While clearing, closing leases stay on disk even
 * after the watchdog relocks. The last clear completes recovery under LOCK.
 * Closing preserves the deadline and any observed overrun until retirement reports it.
 * If storage fails, the closing state also stays in memory so recovery can relock
 * immediately and retry retirement without losing the overrun.
 */
class InstallLease(
    private val store: Store,
    private val env: Env,
    private val relockNow: (() -> Unit)? = null,
    private val restrictionLifted: () -> Boolean = { false },
    private val tracksOverruns: () -> Boolean = { false },
    private val onRecovered: (Boolean) -> Unit = {},
    private val relockCatalogAccounts: () -> Unit = {},
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
        val pendingOverrunMs: Long? = null,
        val id: String? = null,
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

    fun allowsInstall(catalogApproved: Boolean): Boolean = synchronized(LOCK) {
        allowsInstallLocked(catalogApproved)
    }

    private fun allowsInstallLocked(catalogApproved: Boolean): Boolean {
        val open = valid(loadLocked())
        return SELF_UPDATE in open || (catalogApproved && CATALOG in open)
    }

    /** Keeps the durable marker until Android has finished the restriction clear. */
    fun clearIfAllowed(catalogApproved: Boolean, clear: () -> Unit): Boolean =
        clearWhileAllowed({ allowsInstallLocked(catalogApproved) }, clear)

    internal fun catalogId(): String? = synchronized(LOCK) { valid(loadLocked())[CATALOG]?.id }

    internal fun catalogRemainingMs(id: String): Long = synchronized(LOCK) {
        valid(loadLocked())[CATALOG]?.takeIf { it.id == id }
            ?.let { (it.untilMs - env.nowMs()).coerceAtLeast(0) } ?: 0
    }

    internal fun clearCatalogAccountsIfAllowed(id: String, requestId: String, eligible: () -> Boolean, clear: () -> Unit): Boolean =
        clearWhileAllowed({
            if (catalogId() != id || accountClear != null || !eligible()) false
            else {
                accountClear = id to requestId
                true
            }
        }, clear) && catalogId() == id

    internal fun finishCatalogAccounts(requestId: String) = synchronized(LOCK) {
        if (accountClear?.second == requestId) {
            relockCatalogAccounts()
            accountClear = null
        }
    }

    internal fun enforceAccountRestriction(addRestriction: () -> Unit) = synchronized(LOCK) {
        val id = accountClear?.first
        if (id == null || catalogId() != id) addRestriction()
    }

    private fun clearWhileAllowed(allowed: () -> Boolean, clear: () -> Unit): Boolean {
        synchronized(LOCK) {
            if (!allowed()) return false
            clearsInFlight++
        }
        try {
            clear()
        } finally {
            val catalogChanged = synchronized(LOCK) {
                try {
                    recoverLocked("restriction clear finished", finishingClear = true)
                } finally {
                    clearsInFlight--
                }
            }
            catalogChanged?.let(onRecovered)
        }
        return true
    }

    /**
     * Runs session creation in a lease. A session that returns after expiry must be abandoned;
     * recovery is also scheduled independently of this call.
     */
    fun <T> hold(holder: String, durationMs: Long = MAX_MS, block: () -> T): T {
        val lease = start(holder, durationMs)
        try {
            applyLock("install lease opened: $holder", holder == CATALOG)
            check(isOpen(holder, lease.id)) { "Install window expired before session creation" }
            val result = block()
            check(isOpen(holder, lease.id)) { "Install window expired during session creation" }
            return result
        } finally {
            close(holder, "install lease released") { it.id == lease.id }
        }
    }

    fun acquire(holder: String, durationMs: Long) {
        begin(holder, durationMs)
        applyLock("install lease opened: $holder", holder == CATALOG)
    }

    fun begin(holder: String, durationMs: Long) {
        start(holder, durationMs)
    }

    private fun start(holder: String, durationMs: Long): Lease {
        val duration = durationMs.coerceIn(1L, MAX_MS)
        val until = env.nowMs() + duration
        val wallDeadline = env.wallNowMs() + duration
        var started: Lease? = null
        var catalogChanged: Boolean? = null
        try {
            // A catalog target change shares the existing deadline and watchdog.
            if (holder == CATALOG) {
                synchronized(LOCK) {
                    check(clearsInFlight == 0) { "Install restriction clear still in progress" }
                    val current = loadLocked()
                    val open = valid(current)
                    if (current.keys == open.keys) {
                        open[holder]?.let { return it }
                    }
                }
            }

            // The service acknowledges on the main thread. Do not wait for it under LOCK.
            env.prepareExpiry(holder, until)
            env.persistWithWatchdog(holder, until) {
                synchronized(LOCK) {
                    check(clearsInFlight == 0) { "Install restriction clear still in progress" }
                    catalogChanged = recoverLocked("recover before opening install lease")
                    val current = loadLocked()
                    val open = valid(current)
                    check(current.keys == open.keys) { "Previous install window still needs recovery" }
                    val existing = open[holder]
                    if (existing != null) {
                        check(holder == CATALOG) { "Install window already open: $holder" }
                        started = existing
                    } else {
                        check(until > env.nowMs()) { "Install watchdog started after its deadline" }
                        val lease = Lease(until, env.bootCount(), env.versionCode(), env.processId(),
                            wallDeadlineMs = wallDeadline, id = UUID.randomUUID().toString())
                        env.scheduleExpiry(holder, until)
                        store.save(current + (holder to lease))
                        started = lease
                    }
                }
            }
        } finally {
            catalogChanged?.let(onRecovered)
        }
        return checkNotNull(started)
    }

    fun isOpen(holder: String): Boolean = synchronized(LOCK) { holder in valid(loadLocked()) }

    private fun isOpen(holder: String, id: String?): Boolean = synchronized(LOCK) {
        val lease = valid(loadLocked())[holder]
        lease != null && lease.id == id
    }

    fun finishSession(sessionId: Int) =
        close(SELF_UPDATE, "self-update installer result") { it.sessionId == sessionId }

    fun recover(reason: String = "recover install restriction", force: Boolean = false) {
        val catalogChanged = synchronized(LOCK) { recoverLocked(reason, force) }
        catalogChanged?.let(onRecovered)
    }

    /** Returns whether catalog policy needs refreshing, or null when nothing changed. */
    private fun recoverLocked(
        reason: String,
        force: Boolean = false,
        finishingClear: Boolean = false,
        closingHolder: String? = null,
    ): Boolean? {
        val durable = store.load()
        val current = withPendingClosures(durable)
        val open = if (force) emptyMap() else valid(current).filterKeys { it != closingHolder }
        val closing = current - open.keys
        if (closing.isEmpty() && (open.isNotEmpty() || !restrictionLifted())) return null

        // Capture the overrun before relocking, which may change Android's state and then throw.
        val wasLifted = closing.isNotEmpty() && open.isEmpty() &&
            runCatching(restrictionLifted).getOrDefault(false)
        val track = open.isEmpty() && closing.isNotEmpty() && tracksOverruns()
        val pending = closing.mapValues { (holder, lease) ->
            val marker = if (holder == closingHolder) lease.copy(invalidated = true) else lease
            closingLease(marker, track, wasLifted)
        }
        val marked = open + pending
        val writeFailure = try {
            if (marked != durable) saveClosingLocked(marked)
            null
        } catch (e: Exception) {
            e
        }

        try {
            if (open.isEmpty()) {
                if (relockNow == null) applyLock(reason, CATALOG in closing)
                else relockNow.invoke()
            }
        } finally {
            if (CATALOG in closing) {
                relockCatalogAccounts()
                accountClear = null
            }
        }

        if (closing.isEmpty()) return false
        // Include time spent in the policy write. A clear can take effect again
        // after that write, so retain its closing record until it returns.
        val completed = pending.mapValues { (_, lease) -> closingLease(lease, track && wasLifted, wasLifted) }
        if (writeFailure != null) {
            rememberClosures(completed)
            throw writeFailure
        }
        if (completed != pending) saveClosingLocked(open + completed)
        val otherClears = clearsInFlight - if (finishingClear) 1 else 0
        if (otherClears != 0) return false
        val overrun = completed.values.mapNotNull { it.pendingOverrunMs }.maxOrNull()
        store.retire(open, overrun?.let { (it + 999) / 1_000 })
        closing.forEach { (holder, lease) ->
            pendingClosures.remove(closureKey(holder, lease))
            env.cancelExpiry(holder)
        }
        return CATALOG in closing
    }

    private fun closingLease(lease: Lease, track: Boolean, wasLifted: Boolean): Lease {
        val observed = if (track) overrunMs(lease, wasLifted) else null
        val overrun = if (observed == null) lease.pendingOverrunMs else maxOf(observed, lease.pendingOverrunMs ?: 0L)
        return lease.copy(invalidated = true, pendingOverrunMs = overrun)
    }

    private fun loadLocked() = withPendingClosures(store.load())

    private fun withPendingClosures(leases: Map<String, Lease>) =
        leases.mapValues { (holder, lease) -> pendingClosures[closureKey(holder, lease)] ?: lease }

    private fun closureKey(holder: String, lease: Lease) =
        holder to lease.copy(invalidated = false, pendingOverrunMs = null)

    private fun rememberClosures(leases: Map<String, Lease>) {
        leases.forEach { (holder, lease) ->
            if (lease.invalidated) pendingClosures[closureKey(holder, lease)] = lease
        }
    }

    private fun saveClosingLocked(leases: Map<String, Lease>) {
        try {
            store.save(leases)
        } catch (e: Exception) {
            rememberClosures(leases)
            throw e
        }
        leases.forEach { (holder, lease) -> pendingClosures.remove(closureKey(holder, lease)) }
    }

    fun hasMarkers(): Boolean = synchronized(LOCK) { store.load().isNotEmpty() }

    /** Drops [holder]'s lease and applies the lock; the restriction returns unless another lease is open. */
    fun release(holder: String) = close(holder, "install lease released")

    private fun close(holder: String, reason: String, matches: ((Lease) -> Boolean)? = null) {
        val catalogChanged = synchronized(LOCK) {
            val lease = loadLocked()[holder]
            if (matches != null && (lease == null || !matches(lease))) return
            recoverLocked(reason, closingHolder = holder)
        }
        catalogChanged?.let(onRecovered)
    }

    fun invalidate(holder: String): Boolean = synchronized(LOCK) {
        val current = loadLocked()
        val lease = current[holder] ?: return@synchronized false
        invalidateLocked(current, holder, lease)
        true
    }

    private fun invalidateLocked(current: Map<String, Lease>, holder: String, lease: Lease) {
        if (!lease.invalidated) saveClosingLocked(current + (holder to lease.copy(invalidated = true)))
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

    private fun valid(leases: Map<String, Lease>): Map<String, Lease> {
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
        private var accountClear: Pair<String, String>? = null
        // Android creates a new InstallLease for each recovery entry point.
        private val pendingClosures = mutableMapOf<Pair<String, Lease>, Lease>()

        internal fun latestOverrun(context: Context, nowMs: Long): InstallWindowOverrun? = synchronized(LOCK) {
            PrefsLeaseStore(context).latestOverrun(nowMs)
        }

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
                relockCatalogAccounts = {
                    val sync = org.plainphone.app.sync.SyncStore(app)
                    if (!lock.isInMaintenanceWindow(app) && !sync.released && !sync.releaseAsked &&
                        device.isDeviceOwner()
                    ) {
                        device.addRestriction(android.os.UserManager.DISALLOW_MODIFY_ACCOUNTS)
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

internal data class InstallWindowOverrun(val seconds: Long, val sequence: Long, val recordedAtMs: Long)

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
                parts.getOrNull(7)?.toLongOrNull(),
                parts.getOrNull(8)?.takeIf(String::isNotEmpty),
            )
        }.getOrNull()
        lease?.let { holder to it }
    }.toMap()

    @SuppressLint("ApplySharedPref")
    fun latestOverrun(nowMs: Long): InstallWindowOverrun? {
        val parts = prefs.getString(OVERRUN, null)?.split(',') ?: return null
        val seconds = parts.getOrNull(0)?.toLongOrNull() ?: return null
        val sequence = parts.getOrNull(1)?.toLongOrNull() ?: return null
        val recordedAtMs = if (parts.size == 2) {
            // Legacy records have no event time. Start their expiry at first observation.
            prefs.edit().putString(OVERRUN, "$seconds,$sequence,$nowMs").commit()
            nowMs
        } else {
            parts.getOrNull(2)?.toLongOrNull() ?: return null
        }
        return InstallWindowOverrun(seconds, sequence, recordedAtMs)
    }

    override fun save(leases: Map<String, InstallLease.Lease>) = retire(leases, null)

    // commit, not apply: the lease must be on disk before the restriction is lifted.
    @SuppressLint("ApplySharedPref")
    override fun retire(leases: Map<String, InstallLease.Lease>, overrunSeconds: Long?) {
        val previous = (load().keys + leases.keys + OVERRUN).associateWith { prefs.getString(it, null) }
        val edit = prefs.edit()
        (previous.keys - leases.keys - OVERRUN).forEach(edit::remove)
        leases.forEach { (holder, l) ->
            edit.putString(holder, listOf(l.untilMs, l.bootCount, l.versionCode, l.process,
                l.sessionId ?: "", l.wallDeadlineMs ?: "", l.invalidated, l.pendingOverrunMs ?: "",
                l.id ?: "").joinToString(","))
        }
        if (overrunSeconds != null) {
            val priorSequence = previous[OVERRUN]?.split(',')?.getOrNull(1)?.toLongOrNull() ?: 0
            edit.putString(OVERRUN, "$overrunSeconds,${priorSequence + 1},${System.currentTimeMillis()}")
        }
        if (!edit.commit()) {
            // A failed commit may have updated SharedPreferences in memory.
            // Restore the prior markers so a retry can still report them.
            val rollback = prefs.edit()
            previous.forEach { (key, value) -> rollback.putString(key, value) }
            rollback.commit()
            error("Could not persist install leases")
        }
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
        private val process = UUID.randomUUID().toString()
    }

    override fun prepareExpiry(holder: String, atMs: Long) {
        if (org.plainphone.app.light.Mode.isStrong(context) && !InstallWatchdogService.hasBatteryExemption(context)) {
            throw BatteryExemptionMissingException(
                "Plainphone needs a battery exemption to keep the install deadline in Doze",
            )
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
