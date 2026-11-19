// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.requests

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.text.KeyboardOptions
import org.plainphone.app.R
import org.plainphone.app.light.CalmScreen

/** How one request looks to the child. One vocabulary, whoever answered (docs/design-principles.md). */
enum class RowState { WAITING, APPROVED, APPROVED_ON_PHONE, SENDING, DECLINED, WAITING_KEY }

data class RequestRow(val id: String, val kind: PhoneRequest.Kind, val title: String, val state: RowState)

/** The parent PIN box. [message] is an error or a wait, already written out in the child's language. */
data class PinDialog(val requestId: String, val message: String? = null, val busy: Boolean = false)

data class RequestsUi(
    val rows: List<RequestRow>,
    val loading: Boolean = false,
    val failed: Boolean = false,
    /** "A parent is here: approve with PIN" is only offered while the parent keeps this on. */
    val pinApproval: Boolean = true,
    val pin: PinDialog? = null,
    /** A line after an answer, e.g. "A parent already answered this request." */
    val notice: String? = null,
)

class RequestsActions(
    val back: () -> Unit = {},
    val retry: () -> Unit = {},
    val parentIsHere: (String) -> Unit = {},
    val submitPin: (String) -> Unit = {},
    val cancelPin: () -> Unit = {},
)

/** The requests the child has made, and what became of them. */
@Composable
fun RequestsScreen(ui: RequestsUi, actions: RequestsActions) {
    CalmScreen(
        eyebrow = null,
        title = stringResource(R.string.requests_title),
        body = when {
            ui.failed -> stringResource(R.string.requests_load_failed)
            ui.rows.isEmpty() && !ui.loading -> stringResource(R.string.requests_empty)
            else -> null
        },
        primary = stringResource(R.string.requests_back),
        onPrimary = actions.back,
        secondary = if (ui.failed) stringResource(R.string.requests_retry) else null,
        onSecondary = actions.retry,
    ) {
        ui.notice?.let {
            Text(
                it,
                fontSize = 17.sp,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("requests-notice"),
            )
        }
        ui.rows.forEach { row -> RequestCard(row, ui.pinApproval, actions) }
    }
    ui.pin?.let { PinBox(it, actions) }
}

@Composable
private fun RequestCard(row: RequestRow, pinApproval: Boolean, actions: RequestsActions) {
    Surface(
        shape = RoundedCornerShape(16.dp),
        color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
        modifier = Modifier.fillMaxWidth().testTag("request-${row.id}"),
    ) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(
                stringResource(if (row.kind == PhoneRequest.Kind.APP) R.string.requests_kind_app else R.string.requests_kind_contact),
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Text(row.title, fontSize = 19.sp, color = MaterialTheme.colorScheme.onBackground)
            Text(stringResource(statusText(row.state)), fontSize = 16.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            if (row.state == RowState.WAITING && pinApproval) {
                OutlinedButton(
                    onClick = { actions.parentIsHere(row.id) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).testTag("parent-here-${row.id}"),
                    shape = RoundedCornerShape(16.dp),
                ) { Text(stringResource(R.string.requests_parent_here), fontSize = 16.sp) }
            }
        }
    }
}

private fun statusText(state: RowState): Int = when (state) {
    RowState.WAITING -> R.string.requests_status_waiting
    RowState.APPROVED -> R.string.requests_status_approved
    RowState.APPROVED_ON_PHONE -> R.string.requests_status_approved_phone
    RowState.SENDING -> R.string.requests_status_approved_phone_sending
    RowState.DECLINED -> R.string.requests_status_declined
    RowState.WAITING_KEY -> R.string.requests_status_waiting_key
}

/** Asks for the parent PIN. The PIN lives only in this box and is cleared as soon as it is sent. */
@Composable
private fun PinBox(pin: PinDialog, actions: RequestsActions) {
    var entered by remember(pin.requestId) { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!pin.busy) actions.cancelPin() },
        title = { Text(stringResource(R.string.requests_pin_title)) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(stringResource(R.string.requests_pin_help), color = MaterialTheme.colorScheme.onSurfaceVariant)
                OutlinedTextField(
                    value = entered,
                    onValueChange = { entered = it.filter(Char::isDigit).take(12) },
                    label = { Text(stringResource(R.string.requests_pin_hint)) },
                    singleLine = true,
                    enabled = !pin.busy,
                    visualTransformation = PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
                    modifier = Modifier.fillMaxWidth().testTag("pin-field"),
                )
                pin.message?.let {
                    Text(
                        it,
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }.testTag("pin-message"),
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    val sent = entered
                    entered = ""
                    actions.submitPin(sent)
                },
                enabled = entered.isNotEmpty() && !pin.busy,
                modifier = Modifier.testTag("pin-approve"),
            ) { Text(stringResource(R.string.requests_pin_approve)) }
        },
        dismissButton = {
            TextButton(onClick = actions.cancelPin, enabled = !pin.busy, modifier = Modifier.testTag("pin-cancel")) {
                Text(stringResource(R.string.requests_pin_cancel))
            }
        },
    )
}
