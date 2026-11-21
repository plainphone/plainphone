// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.time.Instant
import org.json.JSONObject

/** One line of a conversation with an extended contact, as the server keeps it. */
data class ExtendedLine(
    val id: String,
    val fromChild: Boolean,
    /** `quick`, `reply` or `snapshot`. The text of a snapshot is a placeholder and is never shown. */
    val kind: String,
    val text: String,
    val sentAtMs: Long,
    /** When the other side's device got it; null while it has not. */
    val receivedAtMs: Long?,
) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("from", if (fromChild) "child" else "contact").put("kind", kind)
        .put("text", text).put("sentAt", Instant.ofEpochMilli(sentAtMs).toString())
        .put("receivedAt", receivedAtMs?.let { Instant.ofEpochMilli(it).toString() } ?: JSONObject.NULL)

    companion object {
        fun parse(o: JSONObject): ExtendedLine? {
            val id = o.optString("id")
            val at = runCatching { Instant.parse(o.optString("sentAt")).toEpochMilli() }.getOrNull()
            if (id.isEmpty() || at == null) return null
            val received = if (o.isNull("receivedAt")) null else runCatching { Instant.parse(o.optString("receivedAt")).toEpochMilli() }.getOrNull()
            return ExtendedLine(id, o.optString("from") == "child", o.optString("kind", "quick"), o.optString("text"), at, received)
        }
    }
}

/** The conversation with one person: the newest lines, oldest first. */
data class ExtendedThread(val name: String, val rev: Int, val lines: List<ExtendedLine>) {
    companion object {
        fun parse(o: JSONObject): ExtendedThread {
            val contact = o.getJSONObject("contact")
            val lines = o.optJSONArray("messages")?.let(ServerRules::objects).orEmpty().mapNotNull(ExtendedLine::parse)
            return ExtendedThread(contact.optString("name"), contact.optInt("rev", 0), lines.sortedBy { it.sentAtMs })
        }
    }
}

/** The server's answer to a message or a snapshot: kept, or the person is gone (removed, blocked or never joined). */
data class ExtendedSendAnswer(val stored: Boolean, val gone: Boolean, val kept: Boolean = false)
