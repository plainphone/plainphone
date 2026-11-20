// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app

import android.content.Context
import android.os.SystemClock
import android.provider.Settings

/**
 * The time since boot and which boot it is. Unlike the wall clock, the child cannot change it, also
 * in light mode where automatic time is not forced. A deadline on it only holds within the same boot.
 */
interface BootClock {
    fun elapsedMs(): Long
    fun boot(): Int

    companion object {
        fun of(context: Context): BootClock {
            val resolver = context.applicationContext.contentResolver
            return object : BootClock {
                override fun elapsedMs() = SystemClock.elapsedRealtime()
                override fun boot() = Settings.Global.getInt(resolver, Settings.Global.BOOT_COUNT, -1)
            }
        }
    }
}

/**
 * Pure: whether a maintenance unlock is still open. The wall-clock end alone is not enough in light
 * mode: a child who force-stops Plainphone during the unlock and sets the date back would keep it open
 * until the next reboot. A window stored with a boot-time end closes once that passes or the phone
 * restarts; one stored before that existed falls back to the wall clock.
 */
internal object MaintenanceWindow {
    data class Stored(val wallEndMs: Long, val elapsedEndMs: Long?, val boot: Int?)

    /** When the window ends on the wall clock, or null when it is closed. */
    fun endsAtMs(stored: Stored, wallNowMs: Long, clock: BootClock): Long? {
        if (stored.wallEndMs <= wallNowMs) return null
        val elapsedEnd = stored.elapsedEndMs ?: return stored.wallEndMs
        if (stored.boot != clock.boot()) return null
        val left = elapsedEnd - clock.elapsedMs()
        return if (left > 0) minOf(stored.wallEndMs, wallNowMs + left) else null
    }
}
