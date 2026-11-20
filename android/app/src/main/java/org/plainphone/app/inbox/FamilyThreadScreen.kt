// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.inbox

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.sos.SendState
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.ui.ConversationTopBar
import org.plainphone.app.ui.EmptyState
import org.plainphone.app.ui.Footnote
import org.plainphone.app.ui.MonoSmall
import org.plainphone.app.ui.PlainIcons
import org.plainphone.app.ui.clockTime
import org.plainphone.app.ui.plainTokens
import org.plainphone.app.ui.shortWhen

/** A second tap this soon after the first is taken as the same tap (as in QuickMessagesPanel). */
private const val DOUBLE_TAP_MS = 1_500L

/** The family inbox on the phone, loaded from [FamilyInbox]; [FamilyThread] draws it. */
@Composable
internal fun FamilyThreadScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val changes by FamilyInbox.changes.collectAsState()
    var tick by remember { mutableIntStateOf(0) }
    var entries by remember { mutableStateOf<List<InboxEntry>?>(null) }
    var offer by remember { mutableStateOf<InboxOffer?>(null) }
    var recipients by remember { mutableStateOf(emptyList<String>()) }
    LaunchedEffect(changes, tick) {
        withContext(Dispatchers.IO) {
            entries = FamilyInbox.entries(context)
            offer = FamilyInbox.offer(context)
            recipients = FamilyInbox.thread(context).recipients
            FamilyInbox.cancelNotification(context)
        }
    }
    // While something is on its way, follow its state.
    LaunchedEffect(entries) {
        if (entries.orEmpty().any { it.state == SendState.SENDING }) {
            delay(1_000)
            tick++
        }
    }
    FamilyThread(
        entries, offer, recipients, onBack,
        onSend = { FamilyInbox.send(context, it) },
        onCheckIn = { FamilyInbox.checkIn(context) },
    )
}

/**
 * One thread with the parents: their replies on a sheet with their name, the child's own messages
 * in ink with where each one is. Below, the approved quick messages and "I'm home". A code word
 * looks exactly like any other message. The last line says who can read the thread.
 */
@Composable
internal fun FamilyThread(
    entries: List<InboxEntry>?,
    offer: InboxOffer?,
    recipients: List<String>,
    onBack: () -> Unit,
    onSend: (QuickMessage) -> Boolean,
    onCheckIn: () -> Boolean,
) {
    val t = plainTokens
    var lastTap by remember { mutableLongStateOf(0L) }
    var sent by remember { mutableStateOf<Boolean?>(null) }
    fun once(action: () -> Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (lastTap != 0L && now - lastTap < DOUBLE_TAP_MS) return
        lastTap = now
        sent = action()
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        ConversationTopBar(
            stringResource(R.string.inbox_title),
            subtitle = if (recipients.isEmpty()) stringResource(R.string.inbox_to_parents)
                else stringResource(R.string.inbox_to, recipients.joinToString()),
            onBack = onBack,
        )
        val list = entries.orEmpty().asReversed()
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            reverseLayout = true,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (entries != null && list.isEmpty()) item {
                EmptyState(stringResource(R.string.inbox_empty_title), stringResource(R.string.inbox_empty))
            }
            items(list, key = { it.key }) { InboxBubble(it) }
            item { Footnote(stringResource(R.string.inbox_who_reads), Modifier.padding(bottom = 8.dp)) }
        }
        sent?.let {
            Text(
                stringResource(if (it) R.string.quick_sent else R.string.quick_send_failed),
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        Surface(color = t.sheet, border = BorderStroke(1.dp, t.divider)) {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val quick = offer?.quick.orEmpty()
                if (quick.isNotEmpty()) {
                    Text(
                        stringResource(R.string.quick_title),
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.Bold,
                        modifier = Modifier.semantics { heading() },
                    )
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        quick.forEach { item ->
                            OutlinedButton(
                                onClick = { once { onSend(item) } },
                                modifier = Modifier.heightIn(min = 48.dp),
                                border = BorderStroke(1.dp, t.outline),
                            ) { Text(item.text, color = t.ink) }
                        }
                    }
                }
                if (offer?.checkIns == true) OutlinedButton(
                    onClick = { once(onCheckIn) },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                    border = BorderStroke(1.dp, t.ink),
                ) {
                    Icon(PlainIcons.Home, contentDescription = null, tint = t.ink, modifier = Modifier.size(22.dp))
                    Text(
                        stringResource(R.string.inbox_check_in),
                        Modifier.padding(start = 10.dp),
                        color = t.ink,
                        style = MaterialTheme.typography.titleMedium,
                    )
                }
                if (quick.isEmpty() && offer?.checkIns != true) Text(
                    stringResource(R.string.inbox_nothing_to_send),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun InboxBubble(e: InboxEntry) {
    val context = LocalContext.current
    val t = plainTokens
    val own = e.fromChild
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (own) Alignment.End else Alignment.Start) {
        if (!own && e.author != null) Text(
            e.author,
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
        Surface(
            shape = RoundedCornerShape(20.dp, 20.dp, if (own) 6.dp else 20.dp, if (own) 20.dp else 6.dp),
            color = if (own) t.answerSolid else t.sheet,
            contentColor = if (own) t.onAnswerSolid else t.ink,
            border = if (own) null else BorderStroke(1.dp, t.divider),
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            Row(Modifier.padding(horizontal = 14.dp, vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                if (e.kind == "checkin") Icon(PlainIcons.Home, contentDescription = null, modifier = Modifier.size(20.dp).padding(end = 0.dp))
                Box(Modifier.padding(start = if (e.kind == "checkin") 8.dp else 0.dp)) {
                    Text(e.text, style = MaterialTheme.typography.bodyLarge)
                }
            }
        }
        val time = if (android.text.format.DateUtils.isToday(e.atMs)) clockTime(context, e.atMs) else shortWhen(context, e.atMs)
        val status = when (e.state) {
            null -> time
            SendState.SENDING -> stringResource(R.string.message_sending)
            SendState.SENT -> stringResource(R.string.inbox_state_sent, time)
            SendState.DELIVERED -> stringResource(R.string.inbox_state_delivered, time)
            SendState.SMS -> stringResource(R.string.inbox_state_sms, time)
            SendState.FAILED -> stringResource(R.string.message_failed)
        }
        Text(
            status,
            style = if (e.state == SendState.FAILED) MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold) else MonoSmall,
            color = if (e.state == SendState.FAILED) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}
