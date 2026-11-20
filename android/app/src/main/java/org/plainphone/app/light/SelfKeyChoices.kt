// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import org.plainphone.app.R

/** The word for a level, as in the choice buttons and the summary. */
@Composable
internal fun selfLevelName(level: SelfLevel): String = stringResource(
    when (level) {
        SelfLevel.MILD -> R.string.setup_level_mild
        SelfLevel.FIRM -> R.string.setup_level_firm
        SelfLevel.STRICT -> R.string.setup_level_strict
        SelfLevel.CUSTOM -> R.string.setup_level_custom
    },
)

/**
 * The key choice of Myself setup: Mild, Firm or Strict, each with one plain line about what a
 * looser rule costs. Other wait times sit under a collapsed "Advanced". State is hoisted, so the
 * screen keeps every choice across Back and rotation.
 */
@Composable
internal fun SelfKeyChoices(
    waitHours: Int?,
    trusted: Boolean,
    inviteByQr: Boolean,
    email: String,
    onWaitHours: (Int) -> Unit,
    onTrusted: () -> Unit,
    onInviteByQr: (Boolean) -> Unit,
    onEmail: (String) -> Unit,
) {
    val level = SelfLevel.of(waitHours, trusted)
    var advanced by rememberSaveable { mutableStateOf(false) }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        ChoiceButton(selfLevelName(SelfLevel.MILD), level == SelfLevel.MILD) { onWaitHours(SelfLevel.MILD_HOURS) }
        Text(pluralStringResource(R.plurals.setup_level_wait_line, SelfLevel.MILD_HOURS, SelfLevel.MILD_HOURS))
        ChoiceButton(selfLevelName(SelfLevel.FIRM), level == SelfLevel.FIRM) { onWaitHours(SelfLevel.FIRM_HOURS) }
        Text(pluralStringResource(R.plurals.setup_level_wait_line, SelfLevel.FIRM_HOURS, SelfLevel.FIRM_HOURS))
        ChoiceButton(selfLevelName(SelfLevel.STRICT), level == SelfLevel.STRICT, onTrusted)
        Text(stringResource(R.string.setup_level_strict_line))
    }
    if (trusted) {
        OutlinedButton(onClick = { onInviteByQr(!inviteByQr) }, modifier = Modifier.fillMaxWidth()) {
            Text(stringResource(if (inviteByQr) R.string.setup_key_email else R.string.setup_key_qr))
        }
        if (inviteByQr) Text(stringResource(R.string.setup_key_qr_help))
        else OutlinedTextField(
            value = email,
            onValueChange = onEmail,
            label = { Text(stringResource(R.string.setup_key_email)) },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
        )
        Text(stringResource(R.string.setup_key_trusted_preview, PENDING_KEY_FALLBACK_HOURS))
    }
    OutlinedButton(onClick = { advanced = !advanced }, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(if (advanced) R.string.setup_key_advanced_hide else R.string.setup_key_advanced))
    }
    if (advanced) {
        Text(stringResource(R.string.setup_key_advanced_body))
        for (hours in SelfLevel.WAIT_HOURS) {
            ChoiceButton(stringResource(R.string.setup_key_hours, hours), !trusted && waitHours == hours) { onWaitHours(hours) }
        }
    }
    if (level == SelfLevel.CUSTOM && waitHours != null) {
        Text(
            stringResource(R.string.setup_level_custom) + ": " +
                pluralStringResource(R.plurals.setup_level_wait_line, waitHours, waitHours),
        )
    }
}
