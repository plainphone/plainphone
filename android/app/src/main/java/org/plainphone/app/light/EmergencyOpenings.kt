// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.annotation.SuppressLint
import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import java.time.Instant
import java.time.YearMonth
import java.time.ZoneId
import java.util.UUID
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.sync.SyncApi

/**
 * Limited emergency openings on the phone's own (Self) profile, light mode only.
 *
 * A few times a month the user may open ONE blocked app for a short while (15 minutes). An opening
 * only ever loosens an app block: it never touches calls, texts or the phone app, and 112 and the
 * parents' reachability stay as they are. It is a switch (off by default) that the phone only offers
 * when the rules say it is on.
 *
 * Strong mode (Device Owner) is NOT supported: apps are hidden or suspended there and the guard that
 * could step aside does not run. The feature only exists in light mode.
 *
 * The phone is the authority for what it already did: an opening is recorded here first, so it works
 * offline, and reported afterwards. The server never rejects a report.
 */

/** `selfEmergency` in the rules document. Missing, malformed or `enabled: false` means the feature is off. */
data class EmergencyRules(
    val enabled: Boolean,
    val allowance: Int,
    val minutes: Int,
    /** `YYYY-MM` of the server's count, in the phone's time zone. */
    val usedMonth: String?,
    val usedCount: Int,
) {
    companion object {
        const val DEFAULT_MINUTES = 15
        val OFF = EmergencyRules(false, 0, DEFAULT_MINUTES, null, 0)
        private val MONTH = Regex("\\d{4}-(0[1-9]|1[0-2])")

        /** Never throws: a document from an older or odd server must not break the other rules. */
        fun parse(j: JSONObject?): EmergencyRules = runCatching {
            if (j == null || j.optBoolean("enabled", false) != true) return OFF
            val used = j.optJSONObject("used")
            val month = used?.optString("month", "")?.takeIf { MONTH.matches(it) }
            EmergencyRules(
                enabled = true,
                allowance = j.optInt("allowance", 0).coerceIn(0, 10),
                // The opening is never longer than 15 minutes, whatever a server says.
                minutes = j.optInt("minutes", DEFAULT_MINUTES).coerceIn(1, DEFAULT_MINUTES),
                usedMonth = month,
                usedCount = if (month == null) 0 else used.optInt("count", 0).coerceAtLeast(0),
            )
        }.getOrDefault(OFF)
    }
}

/** One opening the phone has granted itself. [reported] turns true only after the server answered 2xx. */
data class EmergencyOpening(
    val id: String,
    val packageName: String,
    val openedAtMs: Long,
    val minutes: Int,
    val reported: Boolean = false,
)

/** The window that is open now: one app, measured with the clock that keeps running across sleep. */
data class ActiveOpening(
    val packageName: String,
    val startWallMs: Long,
    val startElapsedMs: Long,
    val bootCount: Int,
    val minutes: Int,
)

data class EmergencyState(val openings: List<EmergencyOpening> = emptyList(), val active: ActiveOpening? = null)

/** Where the state lives. Phone: SharedPreferences. Tests: memory. */
interface EmergencyStorage {
    fun load(): EmergencyState
    fun save(state: EmergencyState)
}

class MemoryEmergencyStorage(var state: EmergencyState = EmergencyState()) : EmergencyStorage {
    override fun load() = state
    override fun save(state: EmergencyState) { this.state = state }
}

/** The clocks. Injected, so no test depends on the real date. */
interface EmergencyEnv {
    fun wallMs(): Long
    /** Milliseconds since boot, including sleep. It goes backwards after a reboot. */
    fun elapsedMs(): Long
    /** Changes with every reboot; -1 when unknown. */
    fun bootCount(): Int
    fun newId(): String = UUID.randomUUID().toString()
}

enum class EmergencyRefusal {
    /** Switched off, not a Self phone, or the app is not one an opening can cover. */
    OFF,
    /** The app is not blocked for time or by the allow-list (a protection screen, Plainphone itself). */
    NOT_BLOCKED,
    NONE_LEFT,
    /** An opening is already open for an app. One at a time. */
    BUSY,
}

sealed interface EmergencyStart {
    data class Started(val opening: EmergencyOpening) : EmergencyStart
    data class Refused(val why: EmergencyRefusal) : EmergencyStart
}

class EmergencyOpenings(private val storage: EmergencyStorage, private val env: EmergencyEnv) {

    /** The calendar month of [ms] in the phone's own time zone. [YearMonth] follows DST and midnight rules. */
    fun monthKey(ms: Long, zone: ZoneId): String = YearMonth.from(Instant.ofEpochMilli(ms).atZone(zone)).toString()

    /**
     * Local openings this month, or the server's count for the same month if that is higher: the count
     * survives an app-data clear, and an opening the server has not heard about is never counted twice.
     */
    fun usedThisMonth(rules: EmergencyRules, zone: ZoneId): Int = synchronized(LOCK) {
        val key = monthKey(env.wallMs(), zone)
        val local = storage.load().openings.count { monthKey(it.openedAtMs, zone) == key }
        val server = if (rules.usedMonth == key) rules.usedCount else 0
        maxOf(local, server)
    }

    fun remaining(rules: EmergencyRules, zone: ZoneId): Int =
        if (!rules.enabled) 0 else maxOf(0, rules.allowance - usedThisMonth(rules, zone))

    /**
     * What the stop screen shows: null when nothing is offered (off, a Child phone, or a reason an
     * opening cannot cover), else how many are left (0 = say so, no button).
     */
    fun offer(
        reason: BlockedActivity.Reason?,
        selfProfile: Boolean,
        rules: EmergencyRules,
        zone: ZoneId,
    ): Int? {
        if (!selfProfile || !rules.enabled || !coversReason(reason)) return null
        return remaining(rules, zone)
    }

    /**
     * Records an opening and makes it active. Nothing here needs the network. The caller launches the
     * app afterwards and starts a sync.
     *
     * Only an app blocked for NOT_ALLOWED or TIME_USED_UP can be opened: not a protection screen (the
     * Settings guard), and never Plainphone itself ([ownPackage]).
     */
    fun start(
        packageName: String,
        reason: BlockedActivity.Reason?,
        selfProfile: Boolean,
        rules: EmergencyRules,
        zone: ZoneId,
        ownPackage: String,
    ): EmergencyStart = synchronized(LOCK) {
        if (!selfProfile || !rules.enabled) return EmergencyStart.Refused(EmergencyRefusal.OFF)
        if (packageName.isBlank() || packageName == ownPackage || !coversReason(reason)) {
            return EmergencyStart.Refused(EmergencyRefusal.NOT_BLOCKED)
        }
        val state = storage.load()
        if (state.active != null && windowLeftMs(state.active) > 0) return EmergencyStart.Refused(EmergencyRefusal.BUSY)
        if (remaining(rules, zone) <= 0) return EmergencyStart.Refused(EmergencyRefusal.NONE_LEFT)
        val now = env.wallMs()
        val minutes = rules.minutes.coerceIn(1, EmergencyRules.DEFAULT_MINUTES)
        val opening = EmergencyOpening(env.newId(), packageName, now, minutes)
        storage.save(
            EmergencyState(
                openings = prune(state.openings + opening, now),
                active = ActiveOpening(packageName, now, env.elapsedMs(), env.bootCount(), minutes),
            ),
        )
        EmergencyStart.Started(opening)
    }

    /** Time left in the window; 0 when it is over. Conservative: any sign of a reboot or clock jump ends it. */
    private fun windowLeftMs(a: ActiveOpening): Long {
        val total = a.minutes * 60_000L
        val elapsed = env.elapsedMs()
        // elapsedRealtime goes backwards after a reboot (or the boot count changes): the window is over.
        if (elapsed < a.startElapsedMs) return 0
        if (a.bootCount != env.bootCount()) return 0
        // A wall clock set forward past the window also ends it. A clock set back changes nothing: elapsed rules.
        if (env.wallMs() - a.startWallMs >= total) return 0
        return maxOf(0, total - (elapsed - a.startElapsedMs))
    }

    /** True while the window for exactly this app is open. */
    fun isActive(packageName: String): Boolean = synchronized(LOCK) {
        val a = storage.load().active ?: return false
        a.packageName == packageName && windowLeftMs(a) > 0
    }

    /** Milliseconds until the open window ends, or null when none is open. */
    fun activeLeftMs(): Long? = synchronized(LOCK) {
        val a = storage.load().active ?: return null
        windowLeftMs(a).takeIf { it > 0 }
    }

    /** An opening was recorded for this app and has not been cleared yet (open or just ended). */
    fun hasActiveRecord(packageName: String): Boolean = synchronized(LOCK) {
        storage.load().active?.packageName == packageName
    }

    /** Forgets an opening that has ended. Does nothing while the window is still open. */
    fun clearIfOver(): Unit = synchronized(LOCK) {
        val state = storage.load()
        val a = state.active ?: return
        if (windowLeftMs(a) <= 0) storage.save(state.copy(active = null))
    }

    fun pending(): List<EmergencyOpening> = synchronized(LOCK) { storage.load().openings.filter { !it.reported } }

    fun openings(): List<EmergencyOpening> = synchronized(LOCK) { storage.load().openings }

    fun markReported(id: String): Unit = synchronized(LOCK) {
        val state = storage.load()
        storage.save(state.copy(openings = prune(state.openings.map { if (it.id == id) it.copy(reported = true) else it }, env.wallMs())))
    }

    /** Keeps 90 days. Unreported openings stay until they are reported, however old. */
    private fun prune(list: List<EmergencyOpening>, now: Long) =
        list.filter { !it.reported || now - it.openedAtMs <= KEEP_MS }

    private fun coversReason(reason: BlockedActivity.Reason?) =
        reason == BlockedActivity.Reason.NOT_ALLOWED || reason == BlockedActivity.Reason.TIME_USED_UP

    companion object {
        const val KEEP_MS = 90L * 24 * 60 * 60 * 1000
        private val LOCK = Any()
        private const val PREFS = "plainphone_emergency_openings"
        private const val KEY_STATE = "state"

        /** The phone's own instance: SharedPreferences and the real clocks. Cheap, so callers do not cache it. */
        fun of(context: Context): EmergencyOpenings {
            val app = context.applicationContext
            val prefs = app.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val storage = object : EmergencyStorage {
                override fun load() = EmergencyJson.read(prefs.getString(KEY_STATE, null))
                // commit(), not apply(): the opening must be on disk before the app is launched.
                @SuppressLint("ApplySharedPref")
                override fun save(state: EmergencyState) { prefs.edit().putString(KEY_STATE, EmergencyJson.write(state)).commit() }
            }
            val env = object : EmergencyEnv {
                override fun wallMs() = System.currentTimeMillis()
                override fun elapsedMs() = SystemClock.elapsedRealtime()
                override fun bootCount() = Settings.Global.getInt(app.contentResolver, Settings.Global.BOOT_COUNT, -1)
            }
            return EmergencyOpenings(storage, env)
        }

        /**
         * Reports every opening the server has not heard about, oldest first. Marks one reported only
         * after the server answered; a failure leaves the rest queued for the next sync. A 400 (the
         * server says the report is malformed) is dropped, since sending it again changes nothing.
         */
        fun reportPending(openings: EmergencyOpenings, api: SyncApi, token: String) {
            for (opening in openings.pending().sortedBy { it.openedAtMs }) {
                api.reportEmergencyOpening(token, opening)
                openings.markReported(opening.id)
            }
        }
    }
}

/** The state as JSON, for SharedPreferences. */
internal object EmergencyJson {
    fun write(state: EmergencyState): String = JSONObject()
        .put("openings", JSONArray(state.openings.map {
            JSONObject().put("id", it.id).put("pkg", it.packageName).put("at", it.openedAtMs)
                .put("min", it.minutes).put("reported", it.reported)
        }))
        .apply {
            state.active?.let {
                put("active", JSONObject().put("pkg", it.packageName).put("wall", it.startWallMs)
                    .put("elapsed", it.startElapsedMs).put("boot", it.bootCount).put("min", it.minutes))
            }
        }.toString()

    /** Unreadable state counts as empty: the server's own count still limits the openings. */
    fun read(text: String?): EmergencyState = runCatching {
        val j = JSONObject(text ?: return EmergencyState())
        val list = j.optJSONArray("openings") ?: JSONArray()
        EmergencyState(
            openings = List(list.length()) { list.getJSONObject(it) }.map {
                EmergencyOpening(it.getString("id"), it.getString("pkg"), it.getLong("at"), it.getInt("min"), it.optBoolean("reported", false))
            },
            active = j.optJSONObject("active")?.let {
                ActiveOpening(it.getString("pkg"), it.getLong("wall"), it.getLong("elapsed"), it.getInt("boot"), it.getInt("min"))
            },
        )
    }.getOrDefault(EmergencyState())
}
