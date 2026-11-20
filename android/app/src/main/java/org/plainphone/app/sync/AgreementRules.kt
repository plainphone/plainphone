// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import org.json.JSONArray
import org.json.JSONObject

/**
 * The rules' `ageAgreement` block (docs/family-agreement.md): the family's own words, shown to the
 * child. The server leaves it out while it is off or empty, and older servers do not know it: both
 * mean nothing to show. The text is the family's private data and is never logged.
 */
data class AgreementRules(
    val lines: List<String> = emptyList(),
    val adultLines: List<String> = emptyList(),
    /** Also show the lines on the home screen. */
    val onHome: Boolean = false,
) {
    val isEmpty: Boolean get() = lines.isEmpty() && adultLines.isEmpty()

    companion object {
        val NONE = AgreementRules()
        const val MAX_LINES = 8
        const val MAX_ADULT_LINES = 5
        const val MAX_LENGTH = 140

        /** Lenient: anything that is not a list of strings is dropped, never an error, so rules still apply. */
        fun parse(o: JSONObject?): AgreementRules {
            if (o == null) return NONE
            val parsed = AgreementRules(
                lines = clean(o.optJSONArray("lines"), MAX_LINES),
                adultLines = clean(o.optJSONArray("adultLines"), MAX_ADULT_LINES),
                onHome = o.optBoolean("onHome", false),
            )
            return if (parsed.isEmpty) NONE else parsed
        }

        private fun clean(a: JSONArray?, max: Int): List<String> {
            if (a == null) return emptyList()
            val out = ArrayList<String>()
            for (i in 0 until a.length()) {
                val s = a.opt(i) as? String ?: continue
                val line = s.trim().take(MAX_LENGTH).trim()
                if (line.isNotEmpty()) out.add(line)
                if (out.size == max) break
            }
            return out
        }

        /** What this phone shows: only a child phone that is not being released. */
        fun forChild(rules: ServerRules?): AgreementRules =
            rules?.takeIf { it.profile == "child" && !it.release }?.agreement ?: NONE

        /** The lines for the home screen: only when the parents chose to show them there. */
        fun homeLines(rules: ServerRules?): List<String> = forChild(rules).let { if (it.onHome) it.lines else emptyList() }
    }
}
