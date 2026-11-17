// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.annotation.SuppressLint
import android.content.Context

/**
 * Short, named windows in which Device Owner installs may get through.
 *
 * `DISALLOW_INSTALL_APPS` blocks the Device Owner too, so a self-update (or a catalog install)
 * must lift it. Nobody lifts it directly: a holder opens a lease and re-applies the lock, and
 * [org.plainphone.app.PolicyApplier] leaves the restriction off only while some lease is open.
 * When a holder is done it drops its lease and re-applies the lock again, so the one place that
 * decides is the policy run. Two holders at the same time cannot put the restriction back under
 * each other: it comes back only once the last lease is gone.
 *
 * A lease is also over, whatever the store says, after [MAX_MS], after a reboot, or once the app's
 * own version changed (a self-update that succeeded kills the process before its `finally` runs;
 * `MY_PACKAGE_REPLACED` then applies the lock with the lease already invalid). An alarm at the
 * expiry re-applies the lock if the holder died.
 */
class InstallLease(
    private val store: Store,
    private val env: Env,
    /** Applies the lock (blocking). Exceptions are caught: the expiry alarm is the safety net. */
    private val applyLock: (reason: String) -> Unit,
) {
    data class Lease(val untilMs: Long, val bootCount: Int, val versionCode: Long)

    interface Store {
        fun load(): Map<String, Lease>
        fun save(leases: Map<String, Lease>)
    }

    interface Env {
        fun nowMs(): Long
        fun bootCount(): Int
        fun versionCode(): Long
        /** Wakes the app at [atMs] to apply the lock in case the holder never comes back. */
        fun scheduleExpiry(atMs: Long)
    }

    /** True while any valid lease is open. Read by every policy run. */
    fun isOpen(): Boolean = valid().isNotEmpty()

    /**
     * Runs [block] with installs allowed for at most [durationMs]. The lock is applied again
     * afterwards on every path: normal return, exception, and (via expiry) a dead process.
     */
    fun <T> hold(holder: String, durationMs: Long = MAX_MS, block: () -> T): T {
        val until = env.nowMs() + durationMs.coerceIn(1L, MAX_MS)
        // Written before the restriction is lifted, so a crash right after still leaves the expiry behind.
        synchronized(LOCK) { store.save(valid() + (holder to Lease(until, env.bootCount(), env.versionCode()))) }
        env.scheduleExpiry(until + 1_000L)
        try {
            safeApply("install lease opened: $holder")
            return block()
        } finally {
            release(holder)
        }
    }

    /** Drops [holder]'s lease and applies the lock; the restriction returns unless another lease is open. */
    fun release(holder: String) {
        synchronized(LOCK) { store.save(valid() - holder) }
        safeApply("install lease closed: $holder")
    }

    private fun valid(): Map<String, Lease> {
        val now = env.nowMs()
        val boot = env.bootCount()
        val version = env.versionCode()
        return store.load().filterValues {
            it.untilMs > now && it.untilMs - now <= MAX_MS && it.bootCount == boot && it.versionCode == version
        }
    }

    private fun safeApply(reason: String) {
        try {
            applyLock(reason)
        } catch (e: Exception) {
            android.util.Log.e("Plainphone", "apply after $reason failed; the expiry alarm retries", e)
        }
    }

    companion object {
        /** UserManager.DISALLOW_INSTALL_APPS, as a plain string so the policy code stays JVM-testable. */
        const val RESTRICTION = "no_install_apps"
        const val MAX_MS = 10 * 60_000L
        private val LOCK = Any()

        /** Cheap: only reads preferences. Safe to call from the policy run. */
        fun android(context: Context): InstallLease {
            val app = context.applicationContext
            return InstallLease(PrefsLeaseStore(app), AndroidLeaseEnv(app)) { reason ->
                org.plainphone.app.Lock.applyNow(app, reason)
            }
        }
    }
}

private class PrefsLeaseStore(context: Context) : InstallLease.Store {
    private val prefs = context.getSharedPreferences("plainphone_install_lease", Context.MODE_PRIVATE)

    override fun load(): Map<String, InstallLease.Lease> = prefs.all.mapNotNull { (holder, raw) ->
        val parts = (raw as? String)?.split(',') ?: return@mapNotNull null
        val lease = runCatching { InstallLease.Lease(parts[0].toLong(), parts[1].toInt(), parts[2].toLong()) }.getOrNull()
        lease?.let { holder to it }
    }.toMap()

    // commit, not apply: the lease must be on disk before the restriction is lifted.
    @SuppressLint("ApplySharedPref")
    override fun save(leases: Map<String, InstallLease.Lease>) {
        val edit = prefs.edit().clear()
        leases.forEach { (holder, l) -> edit.putString(holder, "${l.untilMs},${l.bootCount},${l.versionCode}") }
        edit.commit()
    }
}

private class AndroidLeaseEnv(private val context: Context) : InstallLease.Env {
    override fun nowMs() = System.currentTimeMillis()

    override fun bootCount(): Int =
        android.provider.Settings.Global.getInt(context.contentResolver, android.provider.Settings.Global.BOOT_COUNT, -1)

    override fun versionCode(): Long =
        org.plainphone.app.Compat.packageInfo(context.packageManager, context.packageName, 0).longVersionCode

    override fun scheduleExpiry(atMs: Long) = UpdateReceiver.scheduleLeaseExpiry(context, atMs)
}
