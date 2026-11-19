// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R

// Calm and plain: brand direction C, Switch. Graphite on paper, signal green only for "on", red only
// to end a call.
// The values live in PlainTokens, shared with the web dashboard, the parent app and the site.
private fun scheme(t: PlainTokens, dark: Boolean): ColorScheme {
    val base = if (dark) darkColorScheme() else lightColorScheme()
    return base.copy(
        primary = t.action,
        onPrimary = t.onAction,
        primaryContainer = t.tint,
        onPrimaryContainer = t.ink,
        secondary = t.pencil,
        background = t.paper,
        onBackground = t.ink,
        surface = t.paper,
        onSurface = t.ink,
        surfaceVariant = t.divider,
        onSurfaceVariant = t.pencil,
        outline = t.outline,
        outlineVariant = t.divider,
        error = t.danger,
        errorContainer = t.dangerFill,
        onErrorContainer = t.ink,
    )
}

private val Light = scheme(PlainTokens.Light, dark = false)
private val Dark = scheme(PlainTokens.Dark, dark = true)

/** Filled round buttons: end call and decline are red with a white glyph. */
val EndCallRed: Color
    @Composable get() = if (isSystemInDarkTheme()) PlainTokens.Dark.dangerSolid else PlainTokens.Light.dangerSolid

/** Answer and call are ink with a paper glyph ([OnAnswer]): signal green is never a call button. */
val AnswerFill: Color
    @Composable get() = if (isSystemInDarkTheme()) PlainTokens.Dark.answerSolid else PlainTokens.Light.answerSolid
val OnAnswer: Color
    @Composable get() = if (isSystemInDarkTheme()) PlainTokens.Dark.onAnswerSolid else PlainTokens.Light.onAnswerSolid

/** Schibsted Grotesk 400/700 for all text, IBM Plex Mono 500 for times and codes (OFL, assets/licenses/). */
val PlainSans = FontFamily(
    Font(R.font.schibsted_grotesk_regular, FontWeight.Normal),
    Font(R.font.schibsted_grotesk_bold, FontWeight.Bold),
)
val PlainMono = FontFamily(Font(R.font.ibm_plex_mono_medium, FontWeight.Medium))

private fun TextStyle.sans() = copy(fontFamily = PlainSans)

private val PlainTypography = Typography().run {
    copy(
        displayLarge = displayLarge.sans(), displayMedium = displayMedium.sans(), displaySmall = displaySmall.sans(),
        headlineLarge = headlineLarge.sans(), headlineMedium = headlineMedium.sans(), headlineSmall = headlineSmall.sans(),
        titleLarge = titleLarge.sans(), titleMedium = titleMedium.sans(), titleSmall = titleSmall.sans(),
        bodyLarge = bodyLarge.sans(), bodyMedium = bodyMedium.sans(), bodySmall = bodySmall.sans(),
        labelLarge = labelLarge.sans(), labelMedium = labelMedium.sans(), labelSmall = labelSmall.sans(),
    )
}

@Composable
fun PlainphoneTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, typography = PlainTypography, content = content)
}

/** A round initial instead of a photo: contacts have no pictures on a calm phone. */
@Composable
fun Initial(name: String, size: Dp = 48.dp) {
    Box(
        modifier = Modifier.size(size).background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = name.trim().firstOrNull()?.uppercase() ?: "?",
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            fontWeight = FontWeight.SemiBold,
            fontSize = (size.value * 0.42f).sp,
        )
    }
}
