// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import android.content.Context
import android.os.SystemClock
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.sync.QuickMessages
import org.plainphone.app.sync.SyncStore

/** The answer to a suggestion, as the child is told it. */
internal enum class SuggestResult { SENT, WAITING, FAILED }

/** The server's limit for a quick message. */
internal const val QUICK_TEXT_MAX = 60

/** How long "Sent to your parents" stays. */
private const val SENT_SHOWN_MS = 6_000L

/** How often the panel checks whether a sent message failed after all. */
private const val FAILED_POLL_MS = 1_000L

/** A second tap this soon after the first is taken as the same tap. */
private const val DOUBLE_TAP_MS = 1_500L

/**
 * The child's quick messages from the rules, or null when there is nothing to show: not a child phone,
 * released, switched off, or no messages (and, with [withSuggest], no suggestions either).
 */
internal fun childQuickMessages(context: Context, withSuggest: Boolean): QuickMessages? {
    val quick = SilentSos.childSos(SyncStore(context).rules())?.quickMessages ?: return null
    if (!quick.enabled) return null
    if (quick.items.isEmpty() && !(withSuggest && quick.suggest)) return null
    return if (withSuggest) quick else quick.copy(suggest = false)
}

/** Sends a suggestion and tells what happened. Blocking: call it off the main thread. */
internal fun suggestQuickMessage(context: Context, text: String): SuggestResult {
    val token = SyncStore(context).deviceToken() ?: return SuggestResult.FAILED
    return try {
        SosDelivery.api(context).suggestQuickMessage(token, text)
        SuggestResult.SENT
    } catch (e: HttpError) {
        if (e.status == 409) SuggestResult.WAITING else SuggestResult.FAILED
    } catch (_: IOException) {
        SuggestResult.FAILED
    }
}

/**
 * Quick messages for the SOS screen ([withSuggest]) and above the conversations in Messages.
 * Shows nothing unless the parents set some up for this child phone.
 */
@Composable
internal fun ChildQuickMessages(withSuggest: Boolean, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val quick = childQuickMessages(context, withSuggest) ?: return
    QuickMessagesPanel(
        quick.items,
        quick.suggest,
        onSend = { QuickMessageDelivery.send(context, it) },
        failed = { QuickMessageDelivery.failed(context, it) },
        onSuggest = { text -> withContext(Dispatchers.IO) { suggestQuickMessage(context, text) } },
        modifier = modifier,
    )
}

/**
 * One tap sends a message. A code word looks and answers exactly like any other message: the
 * child's screen never says SOS for it (docs/sos.md). [onSend] returns a key for [failed], or null
 * when the message could not be queued; "Sent to your parents" turns into "could not be sent"
 * as soon as [failed] says so.
 */
@Composable
internal fun QuickMessagesPanel(
    items: List<QuickMessage>,
    suggest: Boolean,
    onSend: (QuickMessage) -> String?,
    onSuggest: suspend (String) -> SuggestResult,
    modifier: Modifier = Modifier,
    failed: (String) -> Boolean = { false },
    /** Opens the suggestion form with this text; for previews and tests. */
    initialSuggestion: String? = null,
) {
    val scope = rememberCoroutineScope()
    var sent by remember { mutableStateOf<Boolean?>(null) }
    var sentCount by remember { mutableIntStateOf(0) }
    var sentKey by remember { mutableStateOf<String?>(null) }
    var lastTap by remember { mutableLongStateOf(0L) }
    var editing by rememberSaveable { mutableStateOf(initialSuggestion != null) }
    var draft by rememberSaveable { mutableStateOf(initialSuggestion.orEmpty()) }
    var sending by remember { mutableStateOf(false) }
    var result by remember { mutableStateOf<SuggestResult?>(null) }

    LaunchedEffect(sentCount) {
        val key = sentKey
        if (sentCount == 0 || key == null) return@LaunchedEffect
        // Watch until the worker gives up; a failure stays on screen until the next tap.
        var waited = 0L
        while (waited <= QuickMessageDelivery.GIVE_UP_MS + 60_000L) {
            if (failed(key)) {
                sent = false
                return@LaunchedEffect
            }
            if (waited >= SENT_SHOWN_MS && sent == true) sent = null
            delay(FAILED_POLL_MS)
            waited += FAILED_POLL_MS
        }
    }
    Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (items.isNotEmpty() || suggest) {
            Text(
                stringResource(R.string.quick_title),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { heading() },
            )
        }
        if (items.isNotEmpty()) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                items.forEach { item ->
                    FilledTonalButton(
                        onClick = {
                            val now = SystemClock.elapsedRealtime()
                            if (now - lastTap < DOUBLE_TAP_MS && lastTap != 0L) return@FilledTonalButton
                            lastTap = now
                            sentKey = onSend(item)
                            sent = sentKey != null
                            sentCount++
                        },
                        modifier = Modifier.heightIn(min = 48.dp),
                    ) { Text(item.text) }
                }
            }
        }
        sent?.let {
            Text(
                stringResource(if (it) R.string.quick_sent else R.string.quick_send_failed),
                Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        if (suggest) {
            if (editing) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it.take(QUICK_TEXT_MAX); result = null },
                    label = { Text(stringResource(R.string.quick_suggest_label)) },
                    supportingText = { Text("${draft.length}/$QUICK_TEXT_MAX") },
                    singleLine = true,
                    keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences),
                    modifier = Modifier.fillMaxWidth(),
                )
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(
                        enabled = draft.isNotBlank() && !sending,
                        onClick = {
                            sending = true
                            scope.launch {
                                val answer = onSuggest(draft.trim())
                                sending = false
                                result = answer
                                if (answer == SuggestResult.SENT) {
                                    draft = ""
                                    editing = false
                                }
                            }
                        },
                    ) { Text(stringResource(R.string.quick_suggest_send)) }
                    TextButton(onClick = { editing = false; draft = ""; result = null }) {
                        Text(stringResource(R.string.quick_suggest_cancel))
                    }
                }
            } else {
                TextButton(onClick = { editing = true; result = null }) { Text(stringResource(R.string.quick_suggest)) }
            }
            result?.let {
                Text(
                    stringResource(
                        when (it) {
                            SuggestResult.SENT -> R.string.quick_suggest_sent
                            SuggestResult.WAITING -> R.string.quick_suggest_waiting
                            SuggestResult.FAILED -> R.string.quick_suggest_failed
                        },
                    ),
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            }
        }
    }
}
