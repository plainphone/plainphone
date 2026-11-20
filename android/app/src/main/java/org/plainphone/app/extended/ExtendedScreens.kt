// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.extended

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
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
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.inbox.FamilyInbox
import org.plainphone.app.sync.ContactStatus
import org.plainphone.app.sync.ExtendedContact
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.ui.ConversationTopBar
import org.plainphone.app.ui.EmptyState
import org.plainphone.app.ui.Footnote
import org.plainphone.app.ui.MonoSmall
import org.plainphone.app.ui.PersonRow
import org.plainphone.app.ui.RowDivider
import org.plainphone.app.ui.SectionLabel
import org.plainphone.app.ui.Secondary
import org.plainphone.app.ui.Sheet
import org.plainphone.app.ui.clockTime
import org.plainphone.app.ui.plainTokens
import org.plainphone.app.ui.shortWhen

/** A second tap this soon after the first is taken as the same tap (as in the family thread). */
private const val DOUBLE_TAP_MS = 1_500L

/** What the Messages tab needs of the roster. */
internal data class RosterView(
    val people: List<ExtendedContact>,
    val changes: List<ChangeLine>,
    val previews: Map<String, ConversationLine?>,
    /** The parents paused extended family: the roster shows, nothing is sent, blocking still works. */
    val paused: Boolean = false,
)

/**
 * "Family contacts" below the Family conversation, only while the rules carry `extended`: each
 * person with where they stand, and under them what changed. An invitation has Yes and No thanks.
 */
@Composable
internal fun FamilyContactsSection(onOpen: (String) -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val changes by ExtendedFamily.changes.collectAsState()
    val view by produceState<RosterView?>(null, changes) {
        value = withContext(Dispatchers.IO) {
            val rules = ExtendedFamily.rules(context)
            if (!rules.present) null else {
                val people = ExtendedFamily.roster(context)
                RosterView(
                    people, ExtendedFamily.changeLog(context),
                    people.associate { it.id to ExtendedFamily.lines(context, it.id).lastOrNull() },
                    paused = !rules.enabled,
                )
            }
        }
    }
    val v = view ?: return
    if (v.people.isEmpty() && v.changes.isEmpty()) return
    SectionLabel(stringResource(R.string.ext_section_title))
    if (v.paused) Footnote(stringResource(R.string.ext_paused), Modifier.padding(horizontal = 24.dp, vertical = 4.dp))
    if (v.people.isNotEmpty()) Sheet(Modifier.padding(bottom = 4.dp)) {
        v.people.forEachIndexed { i, c ->
            if (i > 0) RowDivider()
            when (c.status) {
                ContactStatus.WAITING_FOR_CHILD -> PersonRow(
                    c.name,
                    lines = {
                        Secondary(stringResource(R.string.ext_invited_question, c.name), color = MaterialTheme.colorScheme.onSurface)
                        Row(Modifier.padding(top = 8.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(
                                onClick = { scope.launch(Dispatchers.IO) { ExtendedFamily.answer(context, c.id, true); ExtendedFamily.flushNow(context) } },
                                modifier = Modifier.heightIn(min = 48.dp),
                            ) { Text(stringResource(R.string.ext_yes)) }
                            OutlinedButton(
                                onClick = { scope.launch(Dispatchers.IO) { ExtendedFamily.answer(context, c.id, false); ExtendedFamily.flushNow(context) } },
                                modifier = Modifier.heightIn(min = 48.dp),
                                border = BorderStroke(1.dp, plainTokens.outline),
                            ) { Text(stringResource(R.string.ext_no_thanks), color = plainTokens.ink) }
                        }
                    },
                )
                ContactStatus.WAITING_FOR_CONTACT -> PersonRow(c.name, lines = { Secondary(stringResource(R.string.ext_waiting_for, c.name)) })
                ContactStatus.ACTIVE -> {
                    val last = v.previews[c.id]
                    PersonRow(
                        c.name,
                        titleWeight = FontWeight.Bold,
                        onClick = { onOpen(c.id) },
                        aside = last?.let { l -> { Text(shortWhen(context, l.atMs), style = MonoSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
                        lines = {
                            Secondary(
                                when {
                                    last == null -> stringResource(R.string.ext_row_hint, c.name)
                                    last.kind == "snapshot" -> stringResource(R.string.ext_shared_location)
                                    else -> last.text
                                },
                            )
                        },
                    )
                }
                ContactStatus.BLOCKED -> PersonRow(c.name, lines = { Secondary(stringResource(R.string.ext_blocked)) })
            }
        }
    }
    if (v.changes.isNotEmpty()) {
        Column(Modifier.padding(horizontal = 24.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(
                stringResource(R.string.ext_changes_title),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            v.changes.forEach { line ->
                Text(
                    stringResource(changeText(line.kind), line.name) + " · " + shortWhen(context, line.atMs),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun changeText(kind: ChangeKind): Int = when (kind) {
    ChangeKind.INVITED -> R.string.ext_change_invited
    ChangeKind.JOINED -> R.string.ext_change_joined
    ChangeKind.NEW_LINK -> R.string.ext_change_new_link
    ChangeKind.REMOVED -> R.string.ext_change_removed
    ChangeKind.BLOCKED -> R.string.ext_change_blocked
}

/** What the conversation screen needs, loaded off the main thread. */
internal data class ConversationView(
    val contact: ExtendedContact?,
    val lines: List<ConversationLine>,
    val quick: List<QuickMessage>,
    /** The name of the mode that keeps the child from writing to this person right now. */
    val notDuring: String?,
    val snapshot: Boolean,
    val snapshotMinutes: Int,
    /** The parents paused extended family: nothing can be sent, blocking still works. */
    val paused: Boolean = false,
)

/** One person's conversation, loaded from [ExtendedFamily]; [ExtendedConversation] draws it. */
@Composable
internal fun ExtendedConversationScreen(contactId: String, onBack: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val changes by ExtendedFamily.changes.collectAsState()
    var tick by remember { mutableIntStateOf(0) }
    var view by remember { mutableStateOf<ConversationView?>(null) }
    var parentNames by remember { mutableStateOf(emptyList<String>()) }
    LaunchedEffect(changes, tick, contactId) {
        withContext(Dispatchers.IO) {
            val contact = ExtendedFamily.contact(context, contactId)
            view = ConversationView(
                contact,
                ExtendedFamily.lines(context, contactId),
                ExtendedFamily.quickOffer(context),
                contact?.let { ExtendedFamily.blockedByMode(context, it.group) },
                ExtendedFamily.snapshotRules(context).enabled,
                ExtendedFamily.snapshotRules(context).minutes,
                paused = !ExtendedFamily.rules(context).enabled,
            )
            parentNames = FamilyInbox.thread(context).recipients
            ExtendedFamily.cancelNotification(context, contactId)
        }
    }
    // While something is on its way, follow its state.
    LaunchedEffect(view) {
        if (view?.lines.orEmpty().any { it.state == LineState.SENDING }) {
            delay(1_000)
            tick++
        }
    }
    ExtendedConversation(
        view, parentNames, onBack,
        onSend = { message ->
            val ok = ExtendedFamily.send(context, contactId, message)
            if (ok) scope.launch(Dispatchers.IO) { ExtendedFamily.flushNow(context) }
            ok
        },
        onBlock = { scope.launch(Dispatchers.IO) { ExtendedFamily.block(context, contactId); ExtendedFamily.flushNow(context) } },
    )
}

/**
 * The conversation with one person: their replies on a sheet, the child's own messages in ink with
 * where each one is, and at the bottom the approved quick messages, "Share where I am" and Block.
 */
@Composable
internal fun ExtendedConversation(
    view: ConversationView?,
    parentNames: List<String>,
    onBack: () -> Unit,
    onSend: (QuickMessage) -> Boolean,
    onBlock: () -> Unit,
) {
    val t = plainTokens
    val contact = view?.contact
    val name = contact?.name.orEmpty()
    var lastTap by remember { mutableLongStateOf(0L) }
    var sent by remember { mutableStateOf<Boolean?>(null) }
    var confirmBlock by remember { mutableStateOf(false) }
    fun once(action: () -> Boolean) {
        val now = SystemClock.elapsedRealtime()
        if (lastTap != 0L && now - lastTap < DOUBLE_TAP_MS) return
        lastTap = now
        sent = action()
    }
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding()) {
        ConversationTopBar(
            name.ifEmpty { stringResource(R.string.ext_section_title) },
            subtitle = if (contact != null) stringResource(R.string.ext_only_you_and, name) else null,
            onBack = onBack,
            subtitleIsNumber = false,
        )
        val list = view?.lines.orEmpty().asReversed()
        LazyColumn(
            Modifier.weight(1f).fillMaxWidth(),
            reverseLayout = true,
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            if (view != null && contact == null) item { EmptyState(stringResource(R.string.ext_gone_title), stringResource(R.string.ext_gone)) }
            else if (view != null && list.isEmpty()) item {
                EmptyState(stringResource(R.string.ext_empty_title), stringResource(R.string.ext_empty, name))
            }
            items(list, key = { it.key }) { ConversationBubble(it) }
            if (contact != null) item { Footnote(stringResource(R.string.ext_who_reads, name), Modifier.padding(bottom = 8.dp)) }
        }
        sent?.let {
            Text(
                stringResource(if (it) R.string.ext_sent_now else R.string.quick_send_failed),
                Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium,
            )
        }
        if (contact != null) Surface(color = t.sheet, border = BorderStroke(1.dp, t.divider)) {
            Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                val active = contact.status == ContactStatus.ACTIVE
                val notDuring = view.notDuring
                when {
                    contact.status == ContactStatus.BLOCKED -> Text(stringResource(R.string.ext_blocked_note, name), style = MaterialTheme.typography.bodyMedium)
                    !active -> Text(stringResource(R.string.ext_not_active, name), style = MaterialTheme.typography.bodyMedium)
                    view.paused -> Text(stringResource(R.string.ext_paused), style = MaterialTheme.typography.bodyMedium)
                    notDuring != null -> Text(
                        stringResource(R.string.ext_not_during, notDuring),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    view.quick.isNotEmpty() -> {
                        Text(
                            stringResource(R.string.quick_title),
                            style = MaterialTheme.typography.titleSmall,
                            fontWeight = FontWeight.Bold,
                            modifier = Modifier.semantics { heading() },
                        )
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            view.quick.forEach { item ->
                                OutlinedButton(
                                    onClick = { once { onSend(item) } },
                                    modifier = Modifier.heightIn(min = 48.dp),
                                    border = BorderStroke(1.dp, t.outline),
                                ) { Text(item.text, color = t.ink) }
                            }
                        }
                    }
                    else -> Text(
                        stringResource(R.string.inbox_nothing_to_send),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                if (active && view.snapshot && !view.paused) ShareLocationButton(
                    ShareTarget.Person(contact.id, name), parentNames, view.snapshotMinutes, enabled = notDuring == null,
                )
                if (contact.status != ContactStatus.BLOCKED) TextButton(
                    onClick = { confirmBlock = true },
                    modifier = Modifier.heightIn(min = 48.dp),
                ) { Text(stringResource(R.string.ext_block, name), color = t.danger, fontWeight = FontWeight.Bold) }
            }
        }
    }
    if (confirmBlock) AlertDialog(
        onDismissRequest = { confirmBlock = false },
        title = { Text(stringResource(R.string.ext_block_title, name)) },
        text = { Text(stringResource(R.string.ext_block_text, name)) },
        confirmButton = {
            TextButton(onClick = { confirmBlock = false; onBlock() }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(R.string.ext_block_confirm), color = t.danger, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = { confirmBlock = false }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(android.R.string.cancel))
            }
        },
    )
}

@Composable
private fun ConversationBubble(line: ConversationLine) {
    val context = LocalContext.current
    val t = plainTokens
    val own = line.fromChild
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (own) Alignment.End else Alignment.Start) {
        Surface(
            shape = RoundedCornerShape(20.dp, 20.dp, if (own) 6.dp else 20.dp, if (own) 20.dp else 6.dp),
            color = if (own) t.answerSolid else t.sheet,
            contentColor = if (own) t.onAnswerSolid else t.ink,
            border = if (own) null else BorderStroke(1.dp, t.divider),
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            // The text of a snapshot is a placeholder: never shown.
            val text = if (line.kind == "snapshot") stringResource(R.string.ext_shared_location) else line.text
            Text(text, Modifier.padding(horizontal = 14.dp, vertical = 10.dp), style = MaterialTheme.typography.bodyLarge)
        }
        val time = if (android.text.format.DateUtils.isToday(line.atMs)) clockTime(context, line.atMs) else shortWhen(context, line.atMs)
        val status = when (line.state) {
            null -> time
            LineState.SENDING -> stringResource(R.string.message_sending)
            LineState.SENT -> stringResource(R.string.inbox_state_sent, time)
            LineState.DELIVERED -> stringResource(R.string.inbox_state_delivered, time)
            LineState.NOT_DELIVERED -> stringResource(R.string.ext_state_not_delivered)
        }
        val failed = line.state == LineState.NOT_DELIVERED
        Text(
            status,
            style = if (failed) MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold) else MonoSmall,
            color = if (failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
            modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
        )
    }
}
