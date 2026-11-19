// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color

/**
 * The home screen's own small palette: paper, a raised surface, ink, a quieter ink and one accent.
 * GREY uses the graphite of brand direction C (docs/brand/README.md); SAGE and SAND are softer choices.
 * Every pair used for text is at least 4.5:1 (WCAG AA), muted text included.
 */
@Immutable
data class HomeColors(
    val paper: Color,
    val surface: Color,
    val ink: Color,
    val muted: Color,
    val accent: Color,
    val onAccent: Color,
    val dark: Boolean,
)

val LocalHomeColors = staticCompositionLocalOf { homeColors(HomePalette.SAGE, dark = false) }

fun homeColors(palette: HomePalette, dark: Boolean): HomeColors = when (palette) {
    HomePalette.GREY -> if (dark) {
        HomeColors(Color(0xFF0F0F0F), Color(0xFF1B1B1B), Color(0xFFF2F2EF), Color(0xFFB3B3AE), Color(0xFFF2F2EF), Color(0xFF141414), true)
    } else {
        HomeColors(Color(0xFFF5F5F3), Color(0xFFE9E9E6), Color(0xFF141414), Color(0xFF525252), Color(0xFF141414), Color(0xFFFFFFFF), false)
    }
    HomePalette.SAGE -> if (dark) {
        HomeColors(Color(0xFF0F1412), Color(0xFF1A231F), Color(0xFFE3E9E5), Color(0xFFA2B1A9), Color(0xFF9BD1B5), Color(0xFF0B2A1E), true)
    } else {
        HomeColors(Color(0xFFF4F6F3), Color(0xFFE2E9E4), Color(0xFF18211D), Color(0xFF52605A), Color(0xFF2F6B52), Color(0xFFFFFFFF), false)
    }
    HomePalette.SAND -> if (dark) {
        HomeColors(Color(0xFF14120F), Color(0xFF23201B), Color(0xFFEEE8DF), Color(0xFFB4AA9B), Color(0xFFDCCBB0), Color(0xFF2A2117), true)
    } else {
        HomeColors(Color(0xFFF6F2EC), Color(0xFFEAE3D8), Color(0xFF231F1A), Color(0xFF675D52), Color(0xFF5E4F3C), Color(0xFFFFFFFF), false)
    }
}
