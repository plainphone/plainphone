// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.plainphone.app.R

/** How often the screen asks the server how the request is doing while it is open. */
private const val POLL_MS = 10_000L

/**
 * "Ask a parent to call me", below the SOS actions (docs/sos.md#asking-a-parent-to-call). It never replaces
 * SOS, the call to the parents or 112, which stay where they were. Shows nothing unless the parents switched
 * it on for this phone. The request carries no number: the parents call the one they saved.
 */
@Composable
internal fun ChildCallbackRequest(modifier: Modifier = Modifier) {
    val context = LocalContext.current
    if (!CallbackDelivery.enabled(context)) return
    var status by remember { mutableStateOf(CallbackDelivery.status(context)) }
    LaunchedEffect(Unit) {
        while (true) {
            if (callbackOpen(status)) withContext(Dispatchers.IO) { CallbackDelivery.refresh(context) }
            status = CallbackDelivery.status(context)
            delay(POLL_MS)
        }
    }
    CallbackRequestContent(
        status = status,
        onAsk = {
            CallbackDelivery.request(context)
            status = CallbackDelivery.status(context)
        },
        modifier = modifier,
    )
}

@Composable
internal fun CallbackRequestContent(status: CallbackStatus?, onAsk: () -> Unit, modifier: Modifier = Modifier) {
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        FilledTonalButton(
            onClick = onAsk,
            enabled = !callbackOpen(status),
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
        ) { Text(stringResource(R.string.callback_ask)) }
        Text(
            stringResource(
                when (status) {
                    CallbackStatus.WAITING -> R.string.callback_waiting
                    CallbackStatus.QUEUED -> R.string.callback_queued
                    CallbackStatus.SENT -> R.string.callback_sent
                    CallbackStatus.DONE -> R.string.callback_done
                    CallbackStatus.EXPIRED -> R.string.callback_expired
                    CallbackStatus.FAILED -> R.string.callback_failed
                    null -> R.string.callback_hint
                },
            ),
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
        )
    }
}
