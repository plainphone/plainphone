// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.ui.graphics.Color

/**
 * The common semantic roles, one value per role and theme. They are the same values as the web
 * dashboard (`web/src/styles.css`), the parent app (`parent-app/src/lib/theme.ts`) and the site,
 * see docs/research/ux-premium.md. The launcher palettes (sage, sand, grey) are intentional and
 * keep their own values in `home/HomeColors.kt`.
 *
 * [dangerSolid] and [answerSolid] are for filled round call buttons with a white glyph; the soft
 * [danger] is text on paper. Every text pair is at least 4.5:1 and every control outline and
 * filled button is at least 3:1 against the paper (checked in `TokensContrastTest`).
 */
data class PlainTokens(
    val paper: Color,
    val sheet: Color,
    val ink: Color,
    val pencil: Color,
    val divider: Color,
    val outline: Color,
    val action: Color,
    val onAction: Color,
    val tint: Color,
    val attention: Color,
    val danger: Color,
    val dangerFill: Color,
    val dangerSolid: Color,
    val answerSolid: Color,
) {
    companion object {
        val Light = PlainTokens(
            paper = Color(0xFFF2F3EF),
            sheet = Color(0xFFFFFFFF),
            ink = Color(0xFF1C2321),
            pencil = Color(0xFF4D5753),
            divider = Color(0xFFDFE3DF),
            outline = Color(0xFF7A8580),
            action = Color(0xFF24604A),
            onAction = Color(0xFFFFFFFF),
            tint = Color(0xFFE3EFE8),
            attention = Color(0xFFFBF1D9),
            danger = Color(0xFFA3261D),
            dangerFill = Color(0xFFFBE9E7),
            dangerSolid = Color(0xFFA3261D),
            answerSolid = Color(0xFF24604A),
        )

        val Dark = PlainTokens(
            paper = Color(0xFF121816),
            sheet = Color(0xFF1B2320),
            ink = Color(0xFFE8ECE9),
            pencil = Color(0xFFA9B3AE),
            divider = Color(0xFF2C3833),
            outline = Color(0xFF6B7873),
            action = Color(0xFF7FC4A2),
            onAction = Color(0xFF0D1A14),
            tint = Color(0xFF22322B),
            attention = Color(0xFF33301F),
            danger = Color(0xFFF08A80),
            dangerFill = Color(0xFF3A2321),
            dangerSolid = Color(0xFFC9473D),
            answerSolid = Color(0xFF2E7D4F),
        )
    }
}
