// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

// Calm and plain: ink on paper, one muted green for actions, red only to end a call.
private val Ink = Color(0xFF1D2321)
private val Paper = Color(0xFFF7F8F6)
private val Green = Color(0xFF2F6B52)
private val GreenSoft = Color(0xFFD7E8DF)
private val Stone = Color(0xFF5F6A65)

private val Light = lightColorScheme(
    primary = Green,
    onPrimary = Color.White,
    primaryContainer = GreenSoft,
    onPrimaryContainer = Color(0xFF0E2A1E),
    secondary = Stone,
    background = Paper,
    onBackground = Ink,
    surface = Paper,
    onSurface = Ink,
    surfaceVariant = Color(0xFFE6E9E6),
    onSurfaceVariant = Stone,
    error = Color(0xFFB3261E),
)

private val Dark = darkColorScheme(
    primary = Color(0xFF8FCBAE),
    onPrimary = Color(0xFF00382A),
    primaryContainer = Color(0xFF1F4A39),
    onPrimaryContainer = GreenSoft,
    secondary = Color(0xFFB9C4BE),
    background = Color(0xFF121614),
    onBackground = Color(0xFFE2E6E3),
    surface = Color(0xFF121614),
    onSurface = Color(0xFFE2E6E3),
    surfaceVariant = Color(0xFF2B312E),
    onSurfaceVariant = Color(0xFFB9C4BE),
    error = Color(0xFFF2B8B5),
)

val EndCallRed = Color(0xFFC62828)
val AnswerGreen = Color(0xFF2E7D4F)

@Composable
fun PlainphoneTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = if (isSystemInDarkTheme()) Dark else Light, content = content)
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
