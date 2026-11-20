// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.time.Duration
import java.time.Instant
import java.time.LocalTime
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.contacts.ApprovedContact

/** One mode from the parent (docs/modes.md). A null [name] means the preset's translated name. */
data class ModeRule(
    val id: String,
    val preset: String,
    val name: String?,
    val allApps: Boolean,
    val allowedPackages: Set<String>,
    val contactGroups: Set<String>,
    val quiet: Boolean,
)

/**
 * Modes on one weekly schedule. Apps and quiet already reach the lock as `schedules` (the server
 * builds them from the slots), so this only adds what a mode has on top: its name and the contact
 * groups that can call. [slots] reuse [Schedule], with the mode's id as `kind`.
 *
 * @param groups each contact's group, by the number as the server sent it.
 */
data class ModesRules(
    val defaultModeId: String?,
    val modes: List<ModeRule>,
    val slots: List<Schedule>,
    val groups: Map<String, String>,
) {
    companion object {
        /**
         * Null when modes are off, or when the block does not parse: then the phone keeps the
         * `schedules` for apps and quiet and lets every approved contact call, which is the safe side.
         */
        fun parse(j: JSONObject): ModesRules? = runCatching {
            val m = j.optJSONObject("modes") ?: return null
            if (!m.optBoolean("enabled", false)) return null
            val list = ServerRules.objects(m.getJSONArray("list")).map {
                ModeRule(
                    id = it.getString("id"),
                    preset = it.getString("preset"),
                    name = if (it.isNull("name")) null else it.getString("name").takeIf(String::isNotBlank),
                    allApps = it.getBoolean("allApps"),
                    allowedPackages = ServerRules.strings(it.getJSONArray("allowedPackages")),
                    contactGroups = ServerRules.strings(it.getJSONArray("contactGroups")),
                    quiet = it.optBoolean("quiet", false),
                )
            }
            val slots = ServerRules.objects(m.getJSONArray("slots")).map {
                val days = days(it.getJSONArray("days"))
                require(days.isNotEmpty() && days.all { d -> d in 1..7 }) { "bad slot days $days" }
                Schedule(
                    id = it.getString("id"),
                    kind = it.getString("modeId"),
                    days = days,
                    start = LocalTime.parse(it.getString("start")),
                    end = LocalTime.parse(it.getString("end")),
                    allowedPackages = emptySet(),
                )
            }
            val groups = ServerRules.objects(j.getJSONArray("contacts"))
                .filter { it.has("group") }
                .associate { it.getString("number") to it.getString("group") }
            ModesRules(if (m.isNull("defaultModeId")) null else m.getString("defaultModeId"), list, slots, groups)
        }.getOrNull()

        private fun days(a: JSONArray): Set<Int> = (0 until a.length()).map { a.getInt(it) }.toSet()
    }
}

/**
 * The mode the phone is in at one moment. [until] is null for the default mode. When two slots are on
 * at once (only from windows that overlapped before modes), the stricter wins for each part.
 */
data class ActiveMode(
    val mode: ModeRule?,
    val until: LocalTime?,
    val contactGroups: Set<String>?,
    val quiet: Boolean,
) {
    val isDefault: Boolean get() = until == null
}

/** Pure logic for modes, evaluated with the device clock in the phone's time zone. Unit-tested on the JVM. */
object Modes {
    const val FAMILY = "family"

    /** The mode at [now]; null when modes are off. Works offline: only the stored rules and the clock. */
    fun current(rules: ServerRules?, now: Instant): ActiveMode? {
        val modes = rules?.modes ?: return null
        val active = Schedules.active(modes.slots, now, rules.timezone)
            .mapNotNull { slot -> modes.modes.firstOrNull { it.id == slot.kind }?.let { slot to it } }
        if (active.isEmpty()) {
            return ActiveMode(modes.modes.firstOrNull { it.id == modes.defaultModeId }, until = null, contactGroups = null, quiet = false)
        }
        val quiet = active.filter { it.second.quiet }
        // The slot that ends last; an end at or before now is tomorrow's (a slot over midnight).
        val time = now.atZone(rules.timezone).toLocalTime()
        val left = { end: LocalTime -> Math.floorMod(Duration.between(time, end).toMinutes() - 1, 1440L) }
        val (slot, pick) = quiet.ifEmpty { active }.maxBy { left(it.first.end) }
        val groups = active.map { it.second.contactGroups }.reduce { a, b -> a intersect b }
        return ActiveMode(pick, slot.end, groups, quiet.isNotEmpty())
    }

    /**
     * The approved contacts that may call and text at [now]. Outside a slot, with modes off, or with no
     * contact marked as a parent (the phone cannot tell who the parents are), that is every contact.
     * Otherwise the contacts in the mode's groups, and every parent in every mode (docs/always-reachable.md).
     */
    fun allowedContacts(rules: ServerRules?, contacts: List<ApprovedContact>, now: Instant): List<ApprovedContact> {
        val modes = rules?.modes ?: return contacts
        if (rules.profile != "child") return contacts
        val groups = current(rules, now)?.contactGroups ?: return contacts
        val parents = rules.sos?.parents.orEmpty()
        if (parents.isEmpty()) return contacts
        val parentNumbers = parents.map { it.number }.toSet()
        val kept = contacts.filter { c ->
            c.number in parentNumbers || (modes.groups[c.number] ?: OTHERS) in groups
        }
        // A parent is reachable even if the list somehow lacks them.
        return kept + parents.filter { p -> kept.none { it.number == p.number } }
    }

    /** The next start or end of a slot, so the phone switches modes on time also when nothing else wakes it. */
    fun nextBoundary(rules: ServerRules?, now: Instant): Instant? {
        val modes = rules?.modes ?: return null
        return Schedules.nextBoundary(modes.slots, now, rules.timezone)
    }

    private const val OTHERS = "others"
}
