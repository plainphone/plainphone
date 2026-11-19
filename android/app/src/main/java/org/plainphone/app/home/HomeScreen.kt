// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R

/** Everything the home screen draws, already formatted, so previews and screenshot tests are exact. */
data class HomeUi(
    val state: HomeState,
    val time: String,
    val date: String,
    /** Formatted end of school time or bedtime, when one applies. */
    val noticeUntil: String? = null,
    /** Light mode: Plainphone is not the home screen yet, offer to pick it. */
    val offerDefaultHome: Boolean = false,
)

class HomeActions(
    val open: (HomeApp) -> Unit = {},
    val phone: () -> Unit = {},
    val messages: () -> Unit = {},
    val emergency: () -> Unit = {},
    val makeDefault: () -> Unit = {},
    val help: () -> Unit = {},
    val selfTools: (() -> Unit)? = null,
)

@Composable
fun HomeTheme(colors: HomeColors, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalHomeColors provides colors, content = content)
}

@Composable
fun HomeScreen(ui: HomeUi, showAll: Boolean, onShowAll: (Boolean) -> Unit, actions: HomeActions) {
    val c = LocalHomeColors.current
    Box(Modifier.fillMaxSize().background(c.paper)) {
        if (showAll) {
            AllApps(ui.state.all, ui.state.prefs.showFreePromise, onBack = { onShowAll(false) }, open = actions.open)
        } else {
            FrontPage(ui, onShowAll = { onShowAll(true) }, actions)
        }
    }
}

@Composable
private fun FrontPage(ui: HomeUi, onShowAll: () -> Unit, actions: HomeActions) {
    val c = LocalHomeColors.current
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Column(
            Modifier
                .weight(1f)
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 28.dp),
        ) {
            Spacer(Modifier.height(56.dp))
            Clock(ui.time, ui.date)
            ui.noticeUntil?.let { until ->
                Spacer(Modifier.height(20.dp))
                Notice(
                    when (ui.state.notice?.kind) {
                        WindowNotice.Kind.BEDTIME -> stringResource(R.string.home_bedtime_until, until)
                        else -> stringResource(R.string.home_school_until, until)
                    },
                )
            }
            if (ui.offerDefaultHome) {
                Spacer(Modifier.height(28.dp))
                DefaultHomeOffer(actions.makeDefault)
            }
            Spacer(Modifier.height(48.dp))
            if (ui.state.prefs.layout == HomeLayout.GRID) {
                Grid(ui.state.favourites, actions.open)
            } else {
                ui.state.favourites.forEach { ListRow(it, big = true, open = actions.open) }
            }
            Spacer(Modifier.height(12.dp))
            Row(
                Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .clickable(role = Role.Button, onClick = onShowAll)
                    .heightIn(min = 48.dp)
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(stringResource(R.string.home_all_apps), color = c.accent, fontSize = 18.sp, fontWeight = FontWeight.Medium)
                Text("  →", color = c.accent, fontSize = 18.sp, modifier = Modifier.clearAndSetSemantics {})
            }
            actions.selfTools?.let { DockTextButton(stringResource(R.string.self_tools), it) }
            Spacer(Modifier.height(24.dp))
        }
        Dock(actions)
    }
}

@Composable
private fun Clock(time: String, date: String) {
    val c = LocalHomeColors.current
    // The clock is already huge: it does not grow further with the font size, the date does.
    val clockSize = with(LocalDensity.current) { 92.dp.toSp() }
    Column(Modifier.semantics(mergeDescendants = true) { heading() }) {
        Text(
            time,
            color = c.ink,
            style = TextStyle(
                fontSize = clockSize,
                lineHeight = clockSize,
                fontWeight = FontWeight.Light,
                letterSpacing = (-2).sp,
                fontFeatureSettings = "tnum",
            ),
        )
        Spacer(Modifier.height(6.dp))
        Text(date, color = c.muted, fontSize = 19.sp)
    }
}

@Composable
private fun Notice(text: String) {
    val c = LocalHomeColors.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(3.dp).height(20.dp).clip(RoundedCornerShape(2.dp)).background(c.accent))
        Spacer(Modifier.width(12.dp))
        Text(text, color = c.ink, fontSize = 17.sp)
    }
}

@Composable
private fun DefaultHomeOffer(makeDefault: () -> Unit) {
    val c = LocalHomeColors.current
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(20.dp))
            .background(c.surface)
            .padding(20.dp),
    ) {
        Text(stringResource(R.string.home_make_default_title), color = c.ink, fontSize = 18.sp, fontWeight = FontWeight.Medium)
        Spacer(Modifier.height(6.dp))
        Text(stringResource(R.string.home_make_default_body), color = c.muted, fontSize = 15.sp)
        Spacer(Modifier.height(14.dp))
        Box(
            Modifier
                .clip(RoundedCornerShape(14.dp))
                .background(c.accent)
                .clickable(role = Role.Button, onClick = makeDefault)
                .heightIn(min = 48.dp)
                .padding(horizontal = 18.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(stringResource(R.string.home_make_default_button), color = c.onAccent, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        }
    }
}

@Composable
private fun ListRow(app: HomeApp, big: Boolean, open: (HomeApp) -> Unit) {
    val c = LocalHomeColors.current
    val left = app.minutesLeft
    val leftText = when {
        left == null -> null
        left <= 0 -> stringResource(R.string.home_time_used)
        else -> pluralStringResource(R.plurals.home_minutes_left, left, left)
    }
    Row(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(role = Role.Button) { open(app) }
            .heightIn(min = if (big) 60.dp else 52.dp)
            .padding(vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(
            app.label,
            color = if (left != null && left <= 0) c.muted else c.ink,
            fontSize = if (big) 26.sp else 21.sp,
            maxLines = 2,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        leftText?.let {
            Spacer(Modifier.width(12.dp))
            Text(it, color = c.muted, fontSize = 15.sp)
        }
    }
}

@Composable
private fun Grid(apps: List<HomeApp>, open: (HomeApp) -> Unit) {
    val c = LocalHomeColors.current
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        apps.chunked(2).forEach { pair ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                pair.forEach { app ->
                    Column(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(22.dp))
                            .background(c.surface)
                            .clickable(role = Role.Button) { open(app) }
                            .heightIn(min = 104.dp)
                            .padding(18.dp),
                        verticalArrangement = Arrangement.Bottom,
                    ) {
                        app.minutesLeft?.let { left ->
                            Text(
                                if (left <= 0) stringResource(R.string.home_time_used) else pluralStringResource(R.plurals.home_minutes_left, left, left),
                                color = c.muted,
                                fontSize = 13.sp,
                            )
                            Spacer(Modifier.height(4.dp))
                        }
                        Text(app.label, color = c.ink, fontSize = 20.sp, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                }
                if (pair.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
private fun Dock(actions: HomeActions) {
    val c = LocalHomeColors.current
    Column(Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 8.dp)) {
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            DockButton(stringResource(R.string.home_phone), c.accent, c.onAccent, Modifier.weight(1f), icon = true, onClick = actions.phone)
            DockButton(stringResource(R.string.home_messages), c.surface, c.ink, Modifier.weight(1f), onClick = actions.messages)
        }
        DockTextButton(stringResource(R.string.help_lines_title), actions.help)
        DockTextButton(stringResource(R.string.home_emergency), actions.emergency)
    }
}

@Composable
private fun DockTextButton(label: String, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 48.dp)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            label,
            color = LocalHomeColors.current.muted,
            fontSize = 16.sp,
            fontWeight = FontWeight.Medium,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun DockButton(label: String, bg: Color, fg: Color, modifier: Modifier, icon: Boolean = false, onClick: () -> Unit) {
    Row(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(bg)
            .clickable(role = Role.Button, onClick = onClick)
            .heightIn(min = 64.dp)
            .padding(horizontal = 16.dp, vertical = 10.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon) {
            Icon(Icons.Filled.Call, contentDescription = null, tint = fg, modifier = Modifier.size(22.dp))
            Spacer(Modifier.width(10.dp))
        }
        Text(label, color = fg, fontSize = 19.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
private fun AllApps(apps: List<HomeApp>, showFreePromise: Boolean, onBack: () -> Unit, open: (HomeApp) -> Unit) {
    val c = LocalHomeColors.current
    val back = stringResource(R.string.home_back)
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        Row(Modifier.padding(start = 12.dp, end = 28.dp, top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = back, tint = c.ink)
            }
            Spacer(Modifier.width(4.dp))
            Text(
                stringResource(R.string.home_all_apps),
                color = c.ink,
                fontSize = 28.sp,
                fontWeight = FontWeight.Normal,
                modifier = Modifier.semantics { heading() },
            )
        }
        // Grouped by first letter, quietly: the letter is a small muted label, not a heading bar.
        val groups = apps.groupBy { it.label.firstOrNull()?.uppercaseChar()?.takeIf(Char::isLetter) ?: '#' }
        LazyColumn(Modifier.fillMaxSize().padding(horizontal = 28.dp)) {
            if (apps.isEmpty()) {
                item {
                    Text(
                        stringResource(R.string.home_no_apps),
                        color = c.muted,
                        fontSize = 17.sp,
                        modifier = Modifier.padding(vertical = 28.dp),
                    )
                }
            }
            groups.forEach { (letter, group) ->
                item(key = "h$letter") {
                    Text(
                        letter.toString(),
                        color = c.muted,
                        fontSize = 14.sp,
                        fontWeight = FontWeight.Medium,
                        modifier = Modifier.padding(top = 20.dp, bottom = 2.dp).clearAndSetSemantics {},
                    )
                }
                items(group, key = { it.component }) { ListRow(it, big = false, open = open) }
            }
            if (showFreePromise) {
                item {
                    Text(
                        stringResource(R.string.free_promise),
                        color = c.ink,
                        fontSize = 14.sp,
                        modifier = Modifier.padding(vertical = 24.dp),
                    )
                }
            }
        }
    }
}
