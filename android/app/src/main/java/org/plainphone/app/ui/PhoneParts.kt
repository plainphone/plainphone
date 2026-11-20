// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.content.Context
import android.text.format.DateFormat
import android.text.format.DateUtils
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedIconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.Calendar

/**
 * The building blocks of the Phone and Messages apps (brand direction C, docs/brand/README.md):
 * graphite and white, a sheet for grouped rows, ink for calls, red only for danger and signal green
 * only for something that is on. Text wraps instead of truncating, so it works at 200 % text.
 */
val plainTokens: PlainTokens
    @Composable get() = if (isSystemInDarkTheme()) PlainTokens.Dark else PlainTokens.Light

/** Times and numbers in IBM Plex Mono, tabular. */
val MonoSmall: TextStyle
    @Composable get() = MaterialTheme.typography.bodySmall.copy(fontFamily = PlainMono, fontWeight = FontWeight.Medium)

/** 24/30 screen title. */
@Composable
fun ScreenTitle(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier.semantics { heading() },
        fontSize = 24.sp,
        lineHeight = 30.sp,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onBackground,
    )
}

/** A small heading above a group of rows. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        modifier = modifier.padding(horizontal = 20.dp).padding(top = 20.dp, bottom = 8.dp).semantics { heading() },
        style = MaterialTheme.typography.titleSmall,
        fontWeight = FontWeight.Bold,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** Rows grouped on a sheet with a hairline edge. */
@Composable
fun Sheet(modifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    val t = plainTokens
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        color = t.sheet,
        border = BorderStroke(1.dp, t.divider),
    ) { Column(content = content) }
}

/** A hairline between rows on a sheet, inset past the initial. */
@Composable
fun RowDivider(inset: Boolean = true) {
    Box(
        Modifier.fillMaxWidth().padding(start = if (inset) 76.dp else 16.dp).size(height = 1.dp, width = 0.dp)
            .background(plainTokens.divider),
    )
}

/**
 * One person, call or conversation: the initial, a title, lines below it and actions on the
 * right. The whole row is the first action (a call or opening the conversation).
 */
@Composable
fun PersonRow(
    title: String,
    modifier: Modifier = Modifier,
    initial: String = title,
    titleWeight: FontWeight = FontWeight.Normal,
    titleColor: Color = MaterialTheme.colorScheme.onSurface,
    /** Parents: an ink initial, so they stand out from other contacts without colour alone. */
    emphasis: Boolean = false,
    onClick: (() -> Unit)? = null,
    /** Next to the title, at the end of its line: a time. Keeps the title its full width at large text. */
    aside: (@Composable () -> Unit)? = null,
    lines: @Composable ColumnScope.() -> Unit = {},
    actions: @Composable RowScope.() -> Unit = {},
) {
    // At large text the buttons move under the text, so names and numbers keep the full width.
    val stacked = LocalDensity.current.fontScale >= LARGE_TEXT
    Row(
        modifier.fillMaxWidth().heightIn(min = 72.dp)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = if (stacked) Alignment.Top else Alignment.CenterVertically,
    ) {
        Avatar(initial, emphasis)
        Column(Modifier.weight(1f).padding(start = 16.dp, end = if (stacked) 0.dp else 16.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Row(verticalAlignment = Alignment.Top, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(title, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium, fontWeight = titleWeight, color = titleColor)
                aside?.invoke()
            }
            lines()
            if (stacked) Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), content = actions)
        }
        if (!stacked) Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically, content = actions)
    }
}

/** From this font scale on, rows and button pairs stack instead of sitting side by side. */
const val LARGE_TEXT = 1.5f

/** A round initial instead of a photo. Neutral, or ink for a parent; never signal green. */
@Composable
fun Avatar(name: String, emphasis: Boolean = false, size: androidx.compose.ui.unit.Dp = 44.dp) {
    val t = plainTokens
    Box(
        Modifier.size(size).background(if (emphasis) t.answerSolid else t.divider, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            name.trim().firstOrNull()?.uppercase() ?: "?",
            color = if (emphasis) t.onAnswerSolid else t.ink,
            fontWeight = FontWeight.Bold,
            // Decorative: a fixed size, so it never outgrows the circle at large text.
            fontSize = with(androidx.compose.ui.platform.LocalDensity.current) { (size * 0.4f).toSp() },
            maxLines = 1,
        )
    }
}

/** A secondary line: pencil grey, wraps. */
@Composable
fun Secondary(text: String, color: Color = MaterialTheme.colorScheme.onSurfaceVariant, style: TextStyle = MaterialTheme.typography.bodyMedium) {
    Text(text, style = style, color = color)
}

/** The ink call button: calls are ink, never green (brand C). 48 dp. */
@Composable
fun CallButton(description: String, onClick: () -> Unit) {
    FilledIconButton(
        onClick = onClick,
        modifier = Modifier.size(48.dp),
        colors = IconButtonDefaults.filledIconButtonColors(containerColor = AnswerFill, contentColor = OnAnswer),
    ) { Icon(PlainIcons.Phone, contentDescription = description, modifier = Modifier.size(22.dp)) }
}

/** The outlined message button next to a call button. 48 dp. */
@Composable
fun MessageButton(description: String, onClick: () -> Unit) {
    OutlinedIconButton(
        onClick = onClick,
        modifier = Modifier.size(48.dp),
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
    ) { Icon(PlainIcons.Message, contentDescription = description, modifier = Modifier.size(22.dp)) }
}

/** A friendly empty state: one line of what is here, one line of what to do. */
@Composable
fun EmptyState(title: String, text: String? = null, modifier: Modifier = Modifier, action: (@Composable () -> Unit)? = null) {
    Column(
        modifier.fillMaxWidth().padding(horizontal = 32.dp, vertical = 48.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
        if (text != null) Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center)
        action?.invoke()
    }
}

/** A notice that needs a decision or explains a rule: the attention fill, ink text, one action. */
@Composable
fun Notice(text: String, modifier: Modifier = Modifier, action: String? = null, onAction: () -> Unit = {}) {
    Surface(
        modifier = modifier.fillMaxWidth().padding(horizontal = 16.dp),
        shape = RoundedCornerShape(16.dp),
        color = plainTokens.attention,
        contentColor = MaterialTheme.colorScheme.onSurface,
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(text, style = MaterialTheme.typography.bodyLarge)
            if (action != null) TextButton(onClick = onAction, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(action, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** A quiet line under a list: what the list does and does not cover. */
@Composable
fun Footnote(text: String, modifier: Modifier = Modifier) {
    Text(
        text,
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 16.dp),
    )
}

/** A round icon with a word under it: the in-call controls. On is ink filled (state, not decoration). */
@Composable
fun RoundToggle(label: String, icon: ImageVector, on: Boolean, onClick: () -> Unit) {
    val t = plainTokens
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Surface(
            onClick = onClick,
            shape = CircleShape,
            color = if (on) t.action else t.sheet,
            contentColor = if (on) t.onAction else t.ink,
            border = BorderStroke(1.dp, if (on) t.action else t.outline),
            modifier = Modifier.size(64.dp),
        ) {
            Box(contentAlignment = Alignment.Center) { Icon(icon, contentDescription = null, modifier = Modifier.size(26.dp)) }
        }
        Text(label, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center)
    }
}

/**
 * When something happened, short: the clock time today, "Yesterday", the weekday this week, or
 * the date. Uses the phone's 12/24-hour setting and language.
 */
fun shortWhen(context: Context, atMs: Long, nowMs: Long = System.currentTimeMillis()): String {
    val at = Calendar.getInstance().apply { timeInMillis = atMs }
    val now = Calendar.getInstance().apply { timeInMillis = nowMs }
    fun sameDay(a: Calendar, b: Calendar) = a.get(Calendar.YEAR) == b.get(Calendar.YEAR) && a.get(Calendar.DAY_OF_YEAR) == b.get(Calendar.DAY_OF_YEAR)
    val yesterday = (now.clone() as Calendar).apply { add(Calendar.DAY_OF_YEAR, -1) }
    return when {
        sameDay(at, now) -> DateFormat.getTimeFormat(context).format(at.time)
        sameDay(at, yesterday) -> context.getString(org.plainphone.app.R.string.when_yesterday)
        nowMs - atMs in 0 until 6 * DateUtils.DAY_IN_MILLIS ->
            DateUtils.formatDateTime(context, atMs, DateUtils.FORMAT_SHOW_WEEKDAY)
        else -> DateUtils.formatDateTime(context, atMs, DateUtils.FORMAT_SHOW_DATE or DateUtils.FORMAT_ABBREV_MONTH)
    }
}

/** The clock time of a message or call. */
fun clockTime(context: Context, atMs: Long): String = DateFormat.getTimeFormat(context).format(atMs)
