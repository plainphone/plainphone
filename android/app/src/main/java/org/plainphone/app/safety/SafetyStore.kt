// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.sync.SafetyEvent

/**
 * The phone's memory of rings and "Are you okay?" requests: what the child answered (so a screen
 * is not shown twice), events not sent yet, and the alarm volume to put back after a ring.
 */
class SafetyStore(context: Context) {
    private val prefs: SharedPreferences = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    @Synchronized
    fun pending(): List<SafetyEvent> = parse(prefs.getString(KEY_PENDING, null))

    /** Queues an event for the next sync. A repeated event for the same request is kept once. */
    @Synchronized
    fun add(event: SafetyEvent) {
        val list = pending()
        if (event in list) return
        save((list + event).takeLast(MAX_PENDING))
    }

    @Synchronized
    fun done(event: SafetyEvent) = save(pending() - event)

    /** The child pressed "I'm here" on this ring. */
    fun ringAnswered(id: String): Boolean = prefs.getString(KEY_RING_ANSWERED, null) == id
    fun markRingAnswered(id: String) = prefs.edit().putString(KEY_RING_ANSWERED, id).apply()

    /** The child answered this "Are you okay?" ("ok" or "call"). */
    fun checkInAnswered(id: String): Boolean = prefs.getString(KEY_CHECKIN_ANSWERED, null) == id
    fun markCheckInAnswered(id: String) = prefs.edit().putString(KEY_CHECKIN_ANSWERED, id).apply()

    /** The question for this check-in was put on screen already. */
    fun checkInShown(id: String): Boolean = prefs.getString(KEY_CHECKIN_SHOWN, null) == id
    fun markCheckInShown(id: String) = prefs.edit().putString(KEY_CHECKIN_SHOWN, id).apply()

    /** The ring already played to its end (or was stopped) on this phone. */
    fun ringFinished(id: String): Boolean = prefs.getString(KEY_RING_FINISHED, null) == id
    fun markRingFinished(id: String) = prefs.edit().putString(KEY_RING_FINISHED, id).apply()

    /** The alarm volume before a ring raised it; null when nothing needs putting back. */
    var savedAlarmVolume: Int?
        get() = prefs.getInt(KEY_VOLUME, -1).takeIf { it >= 0 }
        set(v) { prefs.edit().apply { if (v == null) remove(KEY_VOLUME) else putInt(KEY_VOLUME, v) }.commit() }

    /** The parent chose "always": the phone shows it on the home screen and in a notification. */
    var sharingAlways: Boolean
        get() = prefs.getBoolean(KEY_ALWAYS, false)
        set(v) { prefs.edit().putBoolean(KEY_ALWAYS, v).apply() }

    /** End of "always" as the server said; null when not "always" or unknown. */
    var alwaysUntilMs: Long?
        get() = prefs.getLong(KEY_ALWAYS_UNTIL, -1L).takeIf { it > 0 }
        set(v) { prefs.edit().apply { if (v == null) remove(KEY_ALWAYS_UNTIL) else putLong(KEY_ALWAYS_UNTIL, v) }.apply() }

    /** The location mode from the last rules, for "What can my parents see?". */
    var locationMode: String?
        get() = prefs.getString(KEY_MODE, null)
        set(v) { prefs.edit().putString(KEY_MODE, v).apply() }

    /**
     * Every time this phone sent its position, newest first. Only on the phone, for the child to
     * see; 30 days at most. Positions sent in a row under "always" are one entry with a range.
     */
    @Synchronized
    fun sharingLog(nowMs: Long = System.currentTimeMillis()): List<SharingEntry> =
        parseLog(prefs.getString(KEY_LOG, null)).filter { nowMs - it.lastMs < LOG_KEEP_MS }

    @Synchronized
    fun logPosition(why: String, atMs: Long) {
        val list = sharingLog(atMs).toMutableList()
        val top = list.firstOrNull()
        if (why == "always" && top != null && top.why == "always" && atMs - top.lastMs <= ALWAYS_GAP_MS) {
            list[0] = top.copy(lastMs = atMs, count = top.count + 1)
        } else {
            list.add(0, SharingEntry(why, atMs, atMs, 1))
        }
        val arr = JSONArray()
        list.take(MAX_LOG).forEach {
            arr.put(JSONObject().put("why", it.why).put("first", it.firstMs).put("last", it.lastMs).put("count", it.count))
        }
        prefs.edit().putString(KEY_LOG, arr.toString()).apply()
    }

    private fun parseLog(text: String?): List<SharingEntry> = runCatching {
        val arr = JSONArray(text ?: return emptyList())
        (0 until arr.length()).map {
            val o = arr.getJSONObject(it)
            SharingEntry(o.getString("why"), o.getLong("first"), o.getLong("last"), o.optInt("count", 1))
        }
    }.getOrDefault(emptyList())

    private fun save(list: List<SafetyEvent>) {
        val arr = JSONArray()
        list.forEach { arr.put(JSONObject().put("id", it.requestId).put("event", it.event)) }
        prefs.edit().putString(KEY_PENDING, arr.toString()).commit()
    }

    private fun parse(text: String?): List<SafetyEvent> = runCatching {
        val arr = JSONArray(text ?: return emptyList())
        (0 until arr.length()).map { arr.getJSONObject(it).let { o -> SafetyEvent(o.getString("id"), o.getString("event")) } }
    }.getOrDefault(emptyList())

    companion object {
        const val PREFS = "plainphone_safety"
        private const val MAX_PENDING = 20
        private const val KEY_PENDING = "pending"
        private const val KEY_RING_ANSWERED = "ring_answered"
        private const val KEY_RING_FINISHED = "ring_finished"
        private const val KEY_CHECKIN_ANSWERED = "checkin_answered"
        private const val KEY_CHECKIN_SHOWN = "checkin_shown"
        private const val KEY_VOLUME = "alarm_volume"
        private const val KEY_ALWAYS = "sharing_always"
        private const val KEY_ALWAYS_UNTIL = "always_until"
        private const val KEY_MODE = "location_mode"
        private const val KEY_LOG = "sharing_log"
        private const val MAX_LOG = 100
        const val LOG_KEEP_MS = 30L * 24 * 60 * 60_000
        /** "Always" positions closer together than this are one log entry. */
        private const val ALWAYS_GAP_MS = 20 * 60_000L
    }
}

/** One line in "What can my parents see?": why, and when (a range for "always"). */
data class SharingEntry(val why: String, val firstMs: Long, val lastMs: Long, val count: Int)
