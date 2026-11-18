// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import android.os.SystemClock
import android.provider.Settings

/** One blocked call or message. Message text is never kept, only who and when. */
data class BlockedEvent(val atMs: Long, val channel: Channel, val direction: Direction, val number: String) {
    fun encode() = "$atMs\t${channel.name}\t${direction.name}\t${number.replace(Regex("[\\t\\n]"), " ")}"

    companion object {
        fun decode(line: String): BlockedEvent? {
            val parts = line.split('\t')
            if (parts.size != 4) return null
            return BlockedEvent(
                atMs = parts[0].toLongOrNull() ?: return null,
                channel = runCatching { Channel.valueOf(parts[1]) }.getOrNull() ?: return null,
                direction = runCatching { Direction.valueOf(parts[2]) }.getOrNull() ?: return null,
                number = parts[3],
            )
        }

        /** Newest first, at most [max] entries. */
        fun append(existing: List<BlockedEvent>, event: BlockedEvent, max: Int): List<BlockedEvent> =
            (listOf(event) + existing).take(max)
    }
}

/**
 * Local log of what the contacts rule blocked, so a parent can see it on the
 * maintenance screen. It stays on the phone; nothing is sent anywhere.
 * Also remembers the last emergency call, for the call-back window.
 */
class TelephonyLog(context: Context) {
    private val app = context.applicationContext
    private val prefs = app.getSharedPreferences("plainphone_telephony", Context.MODE_PRIVATE)

    fun blocked(): List<BlockedEvent> = blocked(ContactPolicySources.get(app).rules())

    private fun blocked(rules: ContactRules): List<BlockedEvent> =
        prefs.getString(KEY_BLOCKED, null).orEmpty().lines().mapNotNull(BlockedEvent::decode)
            .filterNot { rules.isHelpNumber(it.number) }

    @Synchronized
    fun recordBlocked(channel: Channel, direction: Direction, number: String?) {
        val rules = ContactPolicySources.get(app).rules()
        if (rules.isHelpNumber(number)) return
        val event = BlockedEvent(System.currentTimeMillis(), channel, direction, number?.takeIf { it.isNotBlank() } ?: HIDDEN)
        val list = BlockedEvent.append(blocked(rules), event, MAX_EVENTS)
        prefs.edit().putString(KEY_BLOCKED, list.joinToString("\n") { it.encode() }).apply()
    }

    fun clearBlocked() {
        prefs.edit().remove(KEY_BLOCKED).apply()
    }

    /** Uses elapsed realtime, so changing the clock cannot reopen or extend the window. */
    fun recordEmergencyCall() {
        prefs.edit()
            .putLong(KEY_EMERGENCY_ELAPSED, SystemClock.elapsedRealtime())
            .putLong(KEY_EMERGENCY_BOOT, app.telephonyBootId())
            .apply()
    }

    /** Milliseconds since the last emergency call in this boot, or null. */
    fun sinceLastEmergencyMs(): Long? {
        if (!prefs.contains(KEY_EMERGENCY_ELAPSED)) return null
        // elapsedRealtime restarts at boot: an older value belongs to a previous boot.
        if (prefs.getLong(KEY_EMERGENCY_BOOT, -1) != app.telephonyBootId()) return null
        return SystemClock.elapsedRealtime() - prefs.getLong(KEY_EMERGENCY_ELAPSED, 0)
    }

    companion object {
        const val HIDDEN = "hidden number"
        private const val MAX_EVENTS = 100
        private const val KEY_BLOCKED = "blocked"
        private const val KEY_EMERGENCY_ELAPSED = "emergency_elapsed"
        private const val KEY_EMERGENCY_BOOT = "emergency_boot"
    }
}

/** Android's boot counter changes on every reboot. */
internal fun Context.telephonyBootId(): Long =
    Settings.Global.getInt(contentResolver, Settings.Global.BOOT_COUNT, 0).toLong()

/** Wires the policy to this phone's emergency list and call-back window. */
fun Context.contactPolicy(): ContactPolicy {
    val log = TelephonyLog(this)
    return ContactPolicy(EmergencyNumbers.forContext(this)) { log.sinceLastEmergencyMs() }
}
