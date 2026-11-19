// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R
import org.plainphone.app.sync.MORE_TIME_REASON_MAX
import org.plainphone.app.time.MoreTime

/**
 * The stop screen's "Ask for more time": one friendly button, then an optional one-line reason
 * and Send, then the answer in plain words. State in, callbacks out; static, no countdown.
 */
@Composable
fun AskMoreTime(state: MoreTime.Ui, onAsk: () -> Unit, onSend: (String) -> Unit) {
    when (state) {
        MoreTime.Ui.Offer -> AskButton(stringResource(R.string.more_time_ask), onAsk)
        MoreTime.Ui.Composing -> Composing(onSend)
        MoreTime.Ui.Saved -> Status(R.string.more_time_saved_title, stringResource(R.string.more_time_saved_body))
        MoreTime.Ui.Waiting -> Status(R.string.more_time_waiting_title, stringResource(R.string.more_time_waiting_body))
        MoreTime.Ui.NoAnswerYet -> Status(R.string.more_time_no_answer_title, stringResource(R.string.more_time_reach_parent_body))
        is MoreTime.Ui.Approved -> Status(
            R.string.more_time_approved_title,
            state.until?.let { stringResource(R.string.more_time_approved_until, it) }
                ?: stringResource(R.string.more_time_approved_rest_of_day),
        )
        MoreTime.Ui.Declined -> Status(R.string.more_time_declined_title, stringResource(R.string.more_time_tomorrow_body))
        MoreTime.Ui.Expired -> Status(R.string.more_time_expired_title, stringResource(R.string.more_time_tomorrow_body))
        MoreTime.Ui.Unavailable -> Status(R.string.more_time_unavailable_title, stringResource(R.string.more_time_reach_parent_body))
    }
}

@Composable
private fun AskButton(label: String, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        shape = RoundedCornerShape(16.dp),
        colors = ButtonDefaults.filledTonalButtonColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
        ),
    ) { Text(label, fontSize = 17.sp, fontWeight = FontWeight.Medium) }
}

@Composable
private fun Composing(onSend: (String) -> Unit) {
    var reason by rememberSaveable { mutableStateOf("") }
    // Focus moves to the field when it appears, so TalkBack and the keyboard follow the tap.
    val focus = remember { FocusRequester() }
    LaunchedEffect(Unit) { runCatching { focus.requestFocus() } }
    Column {
        OutlinedTextField(
            value = reason,
            onValueChange = { reason = it.replace('\n', ' ').take(MORE_TIME_REASON_MAX) },
            label = { Text(stringResource(R.string.more_time_reason_hint)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Send),
            keyboardActions = KeyboardActions(onSend = { onSend(reason) }),
            textStyle = MaterialTheme.typography.bodyLarge.copy(fontSize = 17.sp),
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp).focusRequester(focus),
        )
        Spacer(Modifier.height(12.dp))
        AskButton(stringResource(R.string.more_time_send)) { onSend(reason) }
    }
}

/** One quiet block: what happened, and what the child can do now. Read out when it changes. */
@Composable
private fun Status(title: Int, body: String) {
    Column(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.primaryContainer, RoundedCornerShape(16.dp))
            .padding(horizontal = 18.dp, vertical = 16.dp)
            .semantics(mergeDescendants = true) { liveRegion = LiveRegionMode.Polite },
    ) {
        Text(
            stringResource(title),
            fontSize = 18.sp,
            lineHeight = 24.sp,
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
        )
        Text(
            body,
            fontSize = 16.sp,
            lineHeight = 23.sp,
            color = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.padding(top = 4.dp),
        )
    }
}
