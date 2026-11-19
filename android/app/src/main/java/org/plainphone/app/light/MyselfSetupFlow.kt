// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import org.plainphone.app.R

/** The screens of "Myself" setup, in order. Back steps one screen and keeps every choice. */
internal enum class MyselfStage {
    VPN, UNDO, KEY, CONFIRM;

    /** The screen before this one. [light] is false when the VPN and undo questions do not apply. */
    fun previous(light: Boolean): MyselfStage? = when (this) {
        VPN -> null
        UNDO -> VPN
        KEY -> if (light) UNDO else null
        CONFIRM -> KEY
    }

    companion object {
        fun first(light: Boolean) = if (light) VPN else KEY
    }
}

/**
 * Until a trusted person accepts, a loosening waits this long. It matches the delay the server
 * stores for a pending trusted key (initial-self-key.ts).
 */
internal const val PENDING_KEY_FALLBACK_HOURS = 24

/** The choice made on a screen, shown filled so it is clear after Back. */
@Composable
internal fun ChoiceButton(label: String, selected: Boolean, onClick: () -> Unit) {
    val modifier = Modifier.fillMaxWidth().semantics { this.selected = selected }
    if (selected) Button(onClick = onClick, modifier = modifier) { Text(label) }
    else OutlinedButton(onClick = onClick, modifier = modifier) { Text(label) }
}

/** The final summary: what can be undone now and what waits for the key later. */
@Composable
internal fun MyselfSummary(undoMinutes: Int, waitHours: Int?, trusted: Boolean, inviteByQr: Boolean, email: String) {
    Text(
        if (undoMinutes == 0) stringResource(R.string.setup_summary_undo_off)
        else stringResource(R.string.setup_summary_undo, undoMinutes),
    )
    Text(
        when {
            !trusted && waitHours != null -> stringResource(R.string.setup_summary_wait, waitHours)
            trusted && inviteByQr -> stringResource(R.string.setup_summary_qr, PENDING_KEY_FALLBACK_HOURS)
            trusted -> stringResource(R.string.setup_summary_email, email.trim(), PENDING_KEY_FALLBACK_HOURS)
            else -> ""
        },
    )
}
