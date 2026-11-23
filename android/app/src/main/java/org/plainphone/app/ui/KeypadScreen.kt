// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.foundation.BorderStroke
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R
import org.plainphone.app.sos.HoldAction

/**
 * The keypad. Two labelled routes sit above the digits so they stay on screen however large the
 * text is: a parent (the People tab) and the emergency call. The number display is hidden from the
 * screen reader and the call button says only "Call", so a spoken status never reads a whole
 * number aloud; each key is still announced as it is pressed. [onCall] returns why a call was not
 * placed, or null; that answer stays on screen until the number changes.
 */
@Composable
internal fun KeypadScreen(
    initial: String, onCall: (String) -> String?, onParents: () -> Unit = {}, showParents: Boolean = true,
    onEmergency: () -> Unit = {}, onBack: (() -> Unit)? = null,
) {
    var number by remember(initial) { mutableStateOf(initial) }
    var hint by remember { mutableStateOf<Int?>(null) }
    var refusal by remember(initial) { mutableStateOf<String?>(null) }
    val t = plainTokens
    Column(
        Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
            if (onBack != null) IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
                Icon(PlainIcons.Back, contentDescription = stringResource(R.string.action_back))
            }
            ScreenTitle(stringResource(R.string.tab_keypad), Modifier.padding(start = if (onBack != null) 8.dp else 0.dp))
        }
        val parent = @Composable { m: Modifier ->
            OutlinedButton(
                onClick = onParents,
                modifier = m.heightIn(min = 64.dp),
                border = BorderStroke(1.dp, t.outline),
                shape = MaterialTheme.shapes.large,
            ) {
                Text(stringResource(R.string.dialer_call_parent), textAlign = TextAlign.Center, style = MaterialTheme.typography.titleMedium, color = t.ink)
            }
        }
        val emergency = @Composable { m: Modifier ->
            Box(m) { HoldAction(stringResource(R.string.sos_emergency), { hint = R.string.sos_hold_emergency; refusal = null }, onEmergency) }
        }
        if (LocalDensity.current.fontScale >= LARGE_TEXT) {
            Column(Modifier.fillMaxWidth().padding(top = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                if (showParents) parent(Modifier.fillMaxWidth())
                emergency(Modifier.fillMaxWidth())
            }
        } else {
            Row(Modifier.fillMaxWidth().padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                if (showParents) parent(Modifier.weight(1f))
                emergency(Modifier.weight(1f))
            }
        }
        (refusal ?: hint?.let { stringResource(it) })?.let {
            Text(
                it,
                Modifier.padding(top = 8.dp).semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Text(
            number.ifEmpty { " " },
            fontSize = 34.sp,
            fontFamily = PlainMono,
            fontWeight = FontWeight.Medium,
            maxLines = 1,
            modifier = Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 4.dp).clearAndSetSemantics {},
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.keypad_hint),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Keypad(onKey = { number += it; refusal = null }, modifier = Modifier.widthIn(max = 320.dp))
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Spacer(Modifier.size(56.dp))
            FilledIconButton(
                onClick = { if (number.isNotBlank()) refusal = onCall(number) },
                modifier = Modifier.size(72.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = AnswerFill, contentColor = OnAnswer),
            ) {
                Icon(PlainIcons.Phone, contentDescription = stringResource(R.string.action_call_plain), modifier = Modifier.size(30.dp))
            }
            IconButton(onClick = { number = number.dropLast(1); refusal = null }, modifier = Modifier.size(56.dp)) {
                Icon(PlainIcons.Backspace, contentDescription = stringResource(R.string.action_delete_digit))
            }
        }
    }
}
