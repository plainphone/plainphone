// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import org.json.JSONObject

/**
 * The hidden ways to send an SOS (docs/sos.md): pressing the power button [presses] times quickly,
 * and holding the home screen clock. Missing from older servers: everything off.
 */
data class HiddenSos(
    val power: Boolean = false,
    val presses: Int = DEFAULT_PRESSES,
    val clock: Boolean = false,
    /** One short vibration as the only confirmation; false means nothing at all. */
    val vibrate: Boolean = true,
) {
    companion object {
        const val DEFAULT_PRESSES = 4
        val OFF = HiddenSos()

        fun parse(o: JSONObject?): HiddenSos = if (o == null) OFF else HiddenSos(
            power = o.optBoolean("power", false),
            presses = o.optInt("presses", DEFAULT_PRESSES).coerceIn(3, 6),
            clock = o.optBoolean("clock", false),
            vibrate = o.optString("feedback", "vibrate") != "none",
        )
    }
}

/** One quick message the parents wrote. A code word ([meansSos]) also sends a silent SOS. */
data class QuickMessage(val id: String, val text: String, val meansSos: Boolean)

/** The child's quick messages. Missing from older servers: none, and no suggestions. */
data class QuickMessages(
    val enabled: Boolean = false,
    val suggest: Boolean = false,
    val items: List<QuickMessage> = emptyList(),
) {
    /** The code words; only these are listed on "What can my parents see?". */
    val codeWords: List<String> get() = if (enabled) items.filter { it.meansSos }.map { it.text } else emptyList()

    companion object {
        val NONE = QuickMessages()

        fun parse(o: JSONObject?): QuickMessages {
            if (o == null) return NONE
            val enabled = o.optBoolean("enabled", false)
            val items = o.optJSONArray("items")?.let(ServerRules::objects).orEmpty().mapNotNull {
                val id = it.optString("id")
                val text = it.optString("text").trim()
                if (id.isEmpty() || text.isEmpty()) null else QuickMessage(id, text, it.optBoolean("meansSos", false))
            }
            return QuickMessages(enabled, enabled && o.optBoolean("suggest", false), if (enabled) items else emptyList())
        }
    }
}

/**
 * "Ask a parent to call" (docs/sos.md#asking-a-parent-to-call): only whether the parents switched it on.
 * The number never reaches the phone. Missing from older servers: off.
 */
data class CallbackRules(val enabled: Boolean = false) {
    companion object {
        val OFF = CallbackRules()

        fun parse(o: JSONObject?): CallbackRules = if (o == null) OFF else CallbackRules(o.optBoolean("enabled", false))
    }
}
