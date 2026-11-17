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
    }
}
