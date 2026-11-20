// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.time.Instant
import org.json.JSONObject

/**
 * The rules' `inbox` block (docs/family-inbox.md). The server leaves it out while the family inbox
 * is off, and older servers do not know it: both mean off. [latest] is the newest parent reply;
 * when it changes, the phone fetches the thread.
 */
data class InboxRules(
    val enabled: Boolean = false,
    val quickMessages: Boolean = false,
    val checkIns: Boolean = false,
    val latest: String? = null,
) {
    companion object {
        val OFF = InboxRules()

        fun parse(o: JSONObject?): InboxRules {
            if (o == null || !o.optBoolean("enabled", false)) return OFF
            return InboxRules(
                enabled = true,
                quickMessages = o.optBoolean("quickMessages", false),
                checkIns = o.optBoolean("checkIns", false),
                latest = o.optString("latest", "").takeIf { it.isNotEmpty() && it != "null" },
            )
        }
    }
}

/** What the phone tells the server about a message sent from the inbox. */
data class InboxSend(val kind: String, val sentAtMs: Long, /** Sent by SMS while offline: only fill in the thread. */ val smsSent: Boolean = false) {
    companion object {
        const val QUICK = "quick"
        const val CHECK_IN = "checkin"
    }
}

/** One message of the thread as the server keeps it. */
data class InboxMessage(
    val id: String,
    val fromChild: Boolean,
    val kind: String,
    val text: String,
    val sentAtMs: Long,
    /** Child messages: parent devices that got a push; 0 means the phone sent an SMS. Null: unknown. */
    val delivered: Int? = null,
    /** Parent replies: the name the parent signed with. */
    val author: String? = null,
) {
    fun toJson(): JSONObject = JSONObject().put("id", id).put("from", if (fromChild) "child" else "parent").put("kind", kind)
        .put("text", text).put("sentAt", Instant.ofEpochMilli(sentAtMs).toString())
        .put("delivered", delivered ?: JSONObject.NULL).put("author", author ?: JSONObject.NULL)

    companion object {
        fun parse(o: JSONObject): InboxMessage? {
            val id = o.optString("id")
            val text = o.optString("text").trim()
            val at = runCatching { Instant.parse(o.optString("sentAt")).toEpochMilli() }.getOrNull()
            if (id.isEmpty() || text.isEmpty() || at == null) return null
            return InboxMessage(
                id, o.optString("from") == "child", o.optString("kind", "quick"), text, at,
                delivered = if (o.has("delivered") && !o.isNull("delivered")) o.optInt("delivered") else null,
                author = o.optString("author", "").takeIf { o.has("author") && !o.isNull("author") && it.isNotBlank() },
            )
        }
    }
}

/** The family inbox thread: who the child's messages go to and the newest messages, oldest first. */
data class InboxThread(val recipients: List<String>, val messages: List<InboxMessage>) {
    companion object {
        val EMPTY = InboxThread(emptyList(), emptyList())

        fun parse(o: JSONObject): InboxThread {
            val recipients = o.optJSONArray("recipients")?.let { a -> List(a.length()) { a.optString(it) } }.orEmpty()
                .filter { it.isNotBlank() }
            val messages = o.optJSONArray("messages")?.let(ServerRules::objects).orEmpty().mapNotNull(InboxMessage::parse)
            return InboxThread(recipients, messages)
        }
    }
}
