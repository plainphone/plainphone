// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.annotation.SuppressLint
import android.content.Context

/**
 * Limits PIN guessing. State is persisted, so killing the app or rebooting
 * does not give fresh attempts. The lockout runs on the wall clock and, within
 * the same boot, on [bootClock] too: in light mode automatic time is not forced,
 * and setting the clock forward must not end a lockout early.
 */
class PinThrottle(
    private val store: Store,
    private val bootClock: BootClock? = null,
    private val now: () -> Long = System::currentTimeMillis,
) {

    interface Store {
        var failures: Int
        var lockedUntil: Long
        /** The same lockout on the boot-time clock, and the boot it was set in. */
        var lockedUntilElapsed: Long
            get() = 0
            set(_) {}
        var lockedBoot: Int
            get() = Int.MIN_VALUE
            set(_) {}
    }

    /** Milliseconds left before the next attempt is allowed. */
    fun remainingMs(): Long {
        // Within the boot the lockout was set in, the boot clock is exact whatever the wall clock says.
        val boot = bootClock?.takeIf { store.lockedBoot == it.boot() }?.let { store.lockedUntilElapsed - it.elapsedMs() }
        // After a reboot only the wall clock is left. Capped: set back, it must not stretch a lockout
        // beyond the longest one.
        return (boot ?: (store.lockedUntil - now())).coerceIn(0, MAX_MS)
    }

    /** The result of [attempt]: locked out (with the time left), or the PIN was checked. */
    sealed interface Attempt {
        data class Locked(val remainingMs: Long) : Attempt
        data class Checked(val ok: Boolean) : Attempt
        /** [attempt]'s `verify` made no real try (null): nothing was counted. */
        data object Skipped : Attempt
    }

    /**
     * The lockout check, the slow PIN check and the record of its result as one step. A process-wide
     * lock keeps two screens (a rotated activity, split screen) from both passing the check before
     * either failure is recorded, which gave extra guesses at each lockout boundary. [verify] returns
     * null when it made no real try (nothing is counted).
     */
    fun attempt(verify: () -> Boolean?): Attempt = synchronized(LOCK) {
        val left = remainingMs()
        if (left > 0) return Attempt.Locked(left)
        when (val ok = verify()) {
            null -> Attempt.Skipped
            true -> { onSuccess(); Attempt.Checked(true) }
            false -> { onFailure(); Attempt.Checked(false) }
        }
    }

    fun onSuccess() {
        store.failures = 0
        store.lockedUntil = 0
        store.lockedUntilElapsed = 0
    }

    fun onFailure() {
        val failures = store.failures + 1
        store.failures = failures
        bootClock?.let {
            store.lockedBoot = it.boot()
            store.lockedUntilElapsed = it.elapsedMs() + lockoutMs(failures)
        }
        store.lockedUntil = now() + lockoutMs(failures)
    }

    companion object {
        private val LOCK = Any()
        const val FREE_ATTEMPTS = 5
        private const val BASE_MS = 60_000L
        private const val MAX_MS = 60 * 60_000L

        /** 0 for the first [FREE_ATTEMPTS] - 1 failures, then 1, 2, 4 ... minutes, capped at an hour. */
        fun lockoutMs(failures: Int): Long {
            if (failures < FREE_ATTEMPTS) return 0
            val doublings = (failures - FREE_ATTEMPTS).coerceAtMost(6)
            return (BASE_MS shl doublings).coerceAtMost(MAX_MS)
        }

        // commit(), not apply(): a failure must be on disk before the app can be force-stopped.
        // Called from a background thread.
        @SuppressLint("ApplySharedPref")
        fun forContext(context: Context): PinThrottle {
            val prefs = context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE)
            return PinThrottle(object : Store {
                override var failures: Int
                    get() = prefs.getInt("pin_failures", 0)
                    set(value) { prefs.edit().putInt("pin_failures", value).commit() }
                override var lockedUntil: Long
                    get() = prefs.getLong("pin_locked_until", 0)
                    set(value) { prefs.edit().putLong("pin_locked_until", value).commit() }
                override var lockedUntilElapsed: Long
                    get() = prefs.getLong("pin_locked_until_elapsed", 0)
                    set(value) { prefs.edit().putLong("pin_locked_until_elapsed", value).commit() }
                override var lockedBoot: Int
                    get() = prefs.getInt("pin_locked_boot", Int.MIN_VALUE)
                    set(value) { prefs.edit().putInt("pin_locked_boot", value).commit() }
            }, BootClock.of(context))
        }
    }
}
