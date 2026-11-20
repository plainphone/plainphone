// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import org.plainphone.app.R
import org.plainphone.app.sync.ActiveMode
import org.plainphone.app.sync.ModeRule

/** The mode's name: what the parent typed, or the preset's name in the phone's language. */
@Composable
fun modeLabel(mode: ModeRule?): String = mode?.name ?: stringResource(
    when (mode?.preset) {
        "school" -> R.string.mode_preset_school
        "homework" -> R.string.mode_preset_homework
        "night" -> R.string.mode_preset_night
        "custom" -> R.string.mode_preset_custom
        else -> R.string.mode_preset_free
    },
)

/** "What can my parents see?": the mode on now and who can call (docs/modes.md). */
@Composable
fun ModeLines(active: ActiveMode) {
    val color = MaterialTheme.colorScheme.onSurfaceVariant
    Text(stringResource(R.string.sharing_mode_now, modeLabel(active.mode)), fontSize = 15.sp, color = color)
    val groups = active.contactGroups
    val text = when {
        groups == null || groups.containsAll(listOf("family", "friends", "others")) -> stringResource(R.string.sharing_mode_everyone)
        groups.isEmpty() -> stringResource(R.string.sharing_mode_only_parents)
        else -> stringResource(
            R.string.sharing_mode_groups,
            listOf("family" to R.string.group_family, "friends" to R.string.group_friends, "others" to R.string.group_others)
                .filter { it.first in groups }
                .map { stringResource(it.second) }
                .joinToString(", "),
        )
    }
    Text(text, fontSize = 15.sp, color = color)
}
