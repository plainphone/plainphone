// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R
import org.plainphone.app.sos.HoldAction

/**
 * The keypad tab. Two labelled routes sit above the digits so they stay on screen however large
 * the text is: a parent (the contacts list) and the emergency call. The number display is hidden
 * from the screen reader and the call button says only "Call", so a spoken status never reads a
 * whole number aloud; each key is still announced as it is pressed.
 */
@Composable
internal fun KeypadScreen(initial: String, onCall: (String) -> Unit, onParents: () -> Unit = {}, showParents: Boolean = true, onEmergency: () -> Unit = {}) {
    var number by remember(initial) { mutableStateOf(initial) }
    var hint by remember { mutableStateOf<Int?>(null) }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            if (showParents) OutlinedButton(onClick = onParents, modifier = Modifier.weight(1f).heightIn(min = 56.dp)) {
                Text(stringResource(R.string.dialer_call_parent), textAlign = TextAlign.Center, fontWeight = FontWeight.Medium)
            }
            Box(Modifier.weight(1f)) {
                HoldAction(stringResource(R.string.sos_emergency), { hint = R.string.sos_hold_emergency }, onEmergency)
            }
        }
        hint?.let {
            Text(
                stringResource(it),
                Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Text(
            number.ifEmpty { " " },
            fontSize = 34.sp,
            fontWeight = FontWeight.Light,
            maxLines = 1,
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp).clearAndSetSemantics {},
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.keypad_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Keypad(onKey = { number += it }, modifier = Modifier.widthIn(max = 320.dp))
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.size(64.dp))
            FilledIconButton(
                onClick = { if (number.isNotBlank()) onCall(number) },
                modifier = Modifier.size(72.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = AnswerFill, contentColor = OnAnswer),
            ) {
                Icon(Icons.Filled.Call, contentDescription = stringResource(R.string.action_call_plain), modifier = Modifier.size(32.dp))
            }
            val delete = stringResource(R.string.action_delete_digit)
            TextButton(
                onClick = { number = number.dropLast(1) },
                modifier = Modifier.size(64.dp).semantics { contentDescription = delete },
            ) {
                Text("⌫", fontSize = 22.sp)
            }
        }
    }
}
