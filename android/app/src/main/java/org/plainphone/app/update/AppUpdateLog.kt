// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import org.json.JSONArray
import org.json.JSONObject

/**
 * What the last app update window did (docs/policies.md, "App updates"), and the guard that
 * decides what happens to a package that arrives while it is open. Pure, so it is unit-tested
 * on the JVM; [AppUpdateWindow] stores it and wires it to Android.
 */
class AppUpdateLog(private val store: Store) {
    enum class Trigger(val wire: String) { NIGHT("night"), PARENT("parent") }

    /** What happens to a package that arrived. */
    enum class Verdict {
        /** Not during a window, or a package the phone already had (Android sends "added" when an app is shown again). */
        IGNORE,
        /** An update of an installed app: allowed. */
        UPDATED,
        /** A new app: hidden at once and sent to the parents as a request. */
        HIDE,
    }

    data class Window(
        val id: String,
        val trigger: Trigger,
        val openedAtMs: Long?,
        /** When the lease ends at the latest (wall clock). */
        val untilMs: Long,
        val closedAtMs: Long? = null,
        /** Every package on the phone when the window opened, hidden ones included. */
        val snapshot: Set<String> = emptySet(),
        val updated: Set<String> = emptySet(),
        val caught: Set<String> = emptySet(),
        /** Why the window could not open: "batteryExemption" or "failed". */
        val error: String? = null,
    ) {
        fun toJson(): JSONObject = JSONObject()
            .put("id", id)
            .put("trigger", trigger.wire)
            .put("openedAtMs", openedAtMs ?: JSONObject.NULL)
            .put("untilMs", untilMs)
            .put("closedAtMs", closedAtMs ?: JSONObject.NULL)
            .put("snapshot", JSONArray(snapshot.sorted()))
            .put("updated", JSONArray(updated.sorted()))
            .put("caught", JSONArray(caught.sorted()))
            .put("error", error ?: JSONObject.NULL)

        companion object {
            fun parse(text: String): Window {
                val j = JSONObject(text)
                fun set(key: String) = j.optJSONArray(key)?.let { a -> List(a.length()) { a.getString(it) }.toSet() }.orEmpty()
                fun long(key: String) = if (j.isNull(key)) null else j.getLong(key)
                return Window(
                    id = j.getString("id"),
                    trigger = Trigger.entries.first { it.wire == j.getString("trigger") },
                    openedAtMs = long("openedAtMs"),
                    untilMs = j.getLong("untilMs"),
                    closedAtMs = long("closedAtMs"),
                    snapshot = set("snapshot"),
                    updated = set("updated"),
                    caught = set("caught"),
                    error = if (j.isNull("error")) null else j.getString("error"),
                )
            }
        }
    }

    /** What the phone tells the server (`PUT /device/status`, `appUpdates`). */
    data class Report(
        val id: String,
        val trigger: Trigger,
        val openedAtMs: Long?,
        val closedAtMs: Long?,
        val updated: Int,
        val caught: List<String>,
        val error: String?,
    )

    interface Store {
        fun load(): Window?
        fun save(window: Window)
    }

    fun current(): Window? = store.load()

    fun opened(id: String, trigger: Trigger, nowMs: Long, untilMs: Long, snapshot: Set<String>) =
        store.save(Window(id, trigger, nowMs, untilMs, snapshot = snapshot))

    fun failed(id: String, trigger: Trigger, nowMs: Long, error: String) =
        store.save(Window(id, trigger, openedAtMs = null, untilMs = nowMs, closedAtMs = nowMs, error = error))

    /** Records the end once; the earliest of the deadline and the moment it was seen closed. */
    fun closed(nowMs: Long) {
        val w = store.load() ?: return
        if (w.closedAtMs != null) return
        store.save(w.copy(closedAtMs = minOf(nowMs, w.untilMs)))
    }

    /**
     * Decides about [pkg], which Android just reported as added. [replacing] is
     * `EXTRA_REPLACING`: an update of an installed app. [leaseOpen] is the install lease.
     */
    fun packageAdded(pkg: String, replacing: Boolean, nowMs: Long, leaseOpen: Boolean): Verdict {
        val w = store.load() ?: return Verdict.IGNORE
        if (w.openedAtMs == null) return Verdict.IGNORE
        // Android may deliver the broadcast just after the lease ended: the install happened inside.
        val end = w.closedAtMs ?: w.untilMs
        if (!leaseOpen && nowMs > end + LATE_BROADCAST_MS) return Verdict.IGNORE
        return when {
            replacing -> Verdict.UPDATED.also { store.save(w.copy(updated = w.updated + pkg)) }
            pkg in w.snapshot -> Verdict.IGNORE
            else -> Verdict.HIDE.also { store.save(w.copy(caught = w.caught + pkg)) }
        }
    }

    /** The last window, with its end filled in once the lease is gone. */
    fun report(nowMs: Long, leaseOpen: Boolean): Report? {
        if (!leaseOpen) closed(nowMs)
        val w = store.load() ?: return null
        return Report(w.id, w.trigger, w.openedAtMs, w.closedAtMs, w.updated.size, w.caught.sorted(), w.error)
    }

    companion object {
        const val LATE_BROADCAST_MS = 60_000L
    }
}
