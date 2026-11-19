// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import org.json.JSONObject

enum class HomeLayout { LIST, GRID }

enum class HomeTheme { SYSTEM, LIGHT, DARK }

/** Calm colour families for the home screen; all of them work in light and dark. */
enum class HomePalette { GREY, SAGE, SAND }

/**
 * How the parent wants the home screen (the `home` object of the rules document,
 * docs/phone-settings.md). Anything missing or unknown falls back to the defaults.
 */
data class HomePrefs(
    val layout: HomeLayout = HomeLayout.LIST,
    val theme: HomeTheme = HomeTheme.SYSTEM,
    val palette: HomePalette = HomePalette.SAGE,
    /** Packages on the front page, in order. */
    val apps: List<String> = emptyList(),
    val showFreePromise: Boolean = true,
) {
    companion object {
        const val MAX_APPS = 8
        val DEFAULT = HomePrefs()

        fun parse(json: JSONObject?): HomePrefs {
            if (json == null) return DEFAULT
            val apps = json.optJSONArray("apps")
                ?.let { a -> (0 until a.length()).mapNotNull { a.optString(it).trim().takeIf(String::isNotEmpty) } }
                .orEmpty()
                .distinct()
                .take(MAX_APPS)
            return HomePrefs(
                layout = enumOr(json.optString("layout"), DEFAULT.layout),
                theme = enumOr(json.optString("theme"), DEFAULT.theme),
                palette = enumOr(json.optString("palette"), DEFAULT.palette),
                apps = apps,
                showFreePromise = json.optBoolean("showFreePromise", DEFAULT.showFreePromise),
            )
        }

        private inline fun <reified T : Enum<T>> enumOr(wire: String, fallback: T): T =
            enumValues<T>().firstOrNull { it.name.equals(wire, ignoreCase = true) } ?: fallback
    }
}
