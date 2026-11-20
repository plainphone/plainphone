// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import org.json.JSONObject

/** Where an extended contact stands, as the server tells the phone (docs/extended-family.md). */
enum class ContactStatus(val wire: String) {
    WAITING_FOR_CHILD("waitingForChild"),
    WAITING_FOR_CONTACT("waitingForContact"),
    ACTIVE("active"),
    BLOCKED("blocked");

    companion object {
        fun fromWire(wire: String?): ContactStatus? = entries.firstOrNull { it.wire == wire }
    }
}

/** One person on the child's roster. [group] is family, friends or others; [rev] changes when the conversation should be fetched. */
data class ExtendedContact(
    val id: String,
    val name: String,
    val status: ContactStatus,
    val group: String,
    val rev: Int,
)

/**
 * The rules' `extended` block (docs/extended-family.md). The server leaves it out while the feature
 * is off with nobody on the roster, and older servers do not know it: both mean off. While paused
 * it comes with `enabled: false` and the roster, so the child still sees who is on it and can block
 * ([present] is then true). A person with a state this app does not know (a newer server) is left
 * out rather than guessed at.
 */
data class ExtendedRules(
    val enabled: Boolean = false,
    val quickMessages: Boolean = false,
    val contacts: List<ExtendedContact> = emptyList(),
    /** The block was in the rules: on, or paused with people on the roster. */
    val present: Boolean = false,
) {
    companion object {
        val OFF = ExtendedRules()

        fun parse(o: JSONObject?): ExtendedRules {
            if (o == null) return OFF
            val enabled = o.optBoolean("enabled", false)
            val list = o.optJSONArray("contacts")?.let(ServerRules::objects).orEmpty().mapNotNull { c ->
                val id = c.optString("id")
                val status = ContactStatus.fromWire(c.optString("status"))
                if (id.isEmpty() || status == null) return@mapNotNull null
                ExtendedContact(
                    id = id,
                    name = c.optString("name").ifBlank { return@mapNotNull null },
                    status = status,
                    group = c.optString("group", "others").ifBlank { "others" },
                    rev = c.optInt("rev", 0),
                )
            }
            return ExtendedRules(enabled, enabled && o.optBoolean("quickMessages", false), list, present = true)
        }
    }
}

/** The rules' `locationSnapshot` block: the child may share where they are once. Off when missing. */
data class SnapshotRules(val enabled: Boolean = false, val minutes: Int = 60) {
    companion object {
        val OFF = SnapshotRules()

        fun parse(o: JSONObject?): SnapshotRules {
            if (o == null || !o.optBoolean("enabled", false)) return OFF
            return SnapshotRules(true, o.optInt("minutes", 60).takeIf { it > 0 } ?: 60)
        }
    }
}
