// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import com.google.common.truth.Truth.assertWithMessage
import org.junit.Test
import org.plainphone.app.home.HomePalette
import org.plainphone.app.home.homeColors

/** WCAG 2.2 AA for the common tokens and for every launcher palette, light and dark. */
class TokensContrastTest {
    private fun ratio(a: Color, b: Color): Double {
        val x = a.luminance().toDouble()
        val y = b.luminance().toDouble()
        return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05)
    }

    private fun atLeast(min: Double, label: String, a: Color, b: Color) =
        assertWithMessage("$label (%s on %s)", a, b).that(ratio(a, b)).isAtLeast(min)

    @Test
    fun `common tokens meet AA in both themes`() {
        for ((name, t) in listOf("light" to PlainTokens.Light, "dark" to PlainTokens.Dark)) {
            for ((surface, s) in listOf("paper" to t.paper, "sheet" to t.sheet)) {
                atLeast(4.5, "$name ink on $surface", t.ink, s)
                atLeast(4.5, "$name pencil on $surface", t.pencil, s)
                atLeast(4.5, "$name action on $surface", t.action, s)
                atLeast(4.5, "$name danger on $surface", t.danger, s)
                atLeast(3.0, "$name control outline on $surface", t.outline, s)
            }
            atLeast(4.5, "$name on action", t.onAction, t.action)
            atLeast(4.5, "$name ink on tint", t.ink, t.tint)
            atLeast(4.5, "$name action on tint", t.action, t.tint)
            atLeast(4.5, "$name ink on attention", t.ink, t.attention)
            atLeast(4.5, "$name danger on danger fill", t.danger, t.dangerFill)
            atLeast(4.5, "$name white glyph on danger button", Color.White, t.dangerSolid)
            atLeast(4.5, "$name glyph on answer button", t.onAnswerSolid, t.answerSolid)
            atLeast(4.5, "$name ink on signal green", t.onBrand, t.brand)
            atLeast(3.0, "$name danger button on paper", t.dangerSolid, t.paper)
            atLeast(3.0, "$name answer button on paper", t.answerSolid, t.paper)
            assertWithMessage("$name: signal green is never a call button").that(t.answerSolid).isNotEqualTo(t.brand)
        }
    }

    @Test
    fun `every launcher palette keeps its text and accent pairs at AA`() {
        for (palette in HomePalette.entries) for (dark in listOf(false, true)) {
            val c = homeColors(palette, dark)
            val name = "$palette ${if (dark) "dark" else "light"}"
            for ((surface, s) in listOf("paper" to c.paper, "surface" to c.surface)) {
                atLeast(4.5, "$name ink on $surface", c.ink, s)
                atLeast(4.5, "$name muted on $surface", c.muted, s)
                atLeast(4.5, "$name accent on $surface", c.accent, s)
            }
            atLeast(4.5, "$name on accent", c.onAccent, c.accent)
        }
    }
}
