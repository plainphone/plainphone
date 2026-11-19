// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.ui.graphics.Color

/**
 * The common semantic roles, one value per role and theme: brand direction C, Switch
 * (docs/brand/README.md, docs/design-tokens.md). They are the same values as the web dashboard
 * (`web/src/styles.css`) and the parent app (`parent-app/src/lib/theme.ts`). The launcher palettes
 * (grey, sage, sand) keep their own values in `home/HomeColors.kt`.
 *
 * [brand] is the signal green. It only means "on" (switches, the mark, active states), always
 * with [onBrand] on it; it is never decoration and never a call or danger button.
 *
 * [dangerSolid] and [answerSolid] are for filled round call buttons, with a white glyph on
 * [dangerSolid] and [onAnswerSolid] on [answerSolid]: the answer and call buttons are ink, not
 * green. The soft [danger] is text on paper. Every text pair is at least 4.5:1 and every control
 * outline and filled button is at least 3:1 against the paper (checked in `TokensContrastTest`).
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
    val brand: Color,
    val onBrand: Color,
    val dangerSolid: Color,
    val answerSolid: Color,
    val onAnswerSolid: Color,
) {
    companion object {
        val Light = PlainTokens(
            paper = Color(0xFFF5F5F3),
            sheet = Color(0xFFFFFFFF),
            ink = Color(0xFF141414),
            pencil = Color(0xFF525252),
            divider = Color(0xFFE3E3E0),
            outline = Color(0xFF767676),
            action = Color(0xFF141414),
            onAction = Color(0xFFFFFFFF),
            tint = Color(0xFFEEF8CF),
            attention = Color(0xFFFFF2C2),
            danger = Color(0xFFB3261E),
            dangerFill = Color(0xFFFDE8E6),
            brand = Color(0xFFC5F04A),
            onBrand = Color(0xFF141414),
            dangerSolid = Color(0xFFB3261E),
            answerSolid = Color(0xFF141414),
            onAnswerSolid = Color(0xFFFFFFFF),
        )

        val Dark = PlainTokens(
            paper = Color(0xFF0F0F0F),
            sheet = Color(0xFF1B1B1B),
            ink = Color(0xFFF2F2EF),
            pencil = Color(0xFFB3B3AE),
            divider = Color(0xFF2D2D2B),
            outline = Color(0xFF7C7C78),
            action = Color(0xFFC5F04A),
            onAction = Color(0xFF141414),
            tint = Color(0xFF27301A),
            attention = Color(0xFF393217),
            danger = Color(0xFFFF8A80),
            dangerFill = Color(0xFF3E1F1D),
            brand = Color(0xFFC5F04A),
            onBrand = Color(0xFF141414),
            dangerSolid = Color(0xFFC9473D),
            answerSolid = Color(0xFFF2F2EF),
            onAnswerSolid = Color(0xFF141414),
        )
    }
}
