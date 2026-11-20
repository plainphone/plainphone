// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.text.format.DateUtils
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.HelpLinks
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.telephony.CallNotifications
import org.plainphone.app.telephony.SmsMessage
import org.plainphone.app.telephony.SmsSender
import org.plainphone.app.telephony.SmsStore
import org.plainphone.app.telephony.SmsThread
import org.plainphone.app.telephony.SmsThreadKind
import org.plainphone.app.telephony.mergeSmsHistory
import org.plainphone.app.telephony.smsHistoryOrder

internal fun SmsThread.canCompose(rules: ContactRules): Boolean =
    kind == SmsThreadKind.CONTACT && (rules.selfProfile || rules.childProfile) && !rules.enforced &&
        android.telephony.PhoneNumberUtils.isGlobalPhoneNumber(number)

@Composable
internal fun historyTitle(thread: SmsThread, contact: ApprovedContact?): String = when {
    thread.participants.isNotEmpty() -> thread.participants.joinToString()
    thread.kind == SmsThreadKind.MMS -> stringResource(R.string.history_mms)
    contact != null -> contact.name
    else -> thread.number.ifBlank { stringResource(R.string.history_unknown) }
}

/**
 * The conversation list. Unread conversations are bold with a dot and the word "New" for the
 * screen reader; a conversation the child cannot answer says so. [header] is the family inbox or
 * the quick messages, pinned above the conversations.
 */
@Composable
internal fun ConversationsScreen(
    rules: ContactRules,
    history: Map<SmsThread, List<SmsMessage>>?,
    state: LazyListState,
    hasMore: Boolean,
    failed: Boolean,
    loading: Boolean,
    onMore: () -> Unit,
    onOpen: (SmsThread) -> Unit,
    parents: Set<String> = emptySet(),
    header: (@Composable () -> Unit)? = null,
) {
    val context = LocalContext.current
    val index = history.orEmpty()
    LazyColumn(state = state, contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp)) {
        header?.let { item { it() } }
        if (history != null && index.isEmpty() && !failed && !loading) {
            item { EmptyState(stringResource(R.string.messages_empty), stringResource(R.string.messages_empty_hint)) }
            return@LazyColumn
        }
        if (index.isNotEmpty()) item {
            Sheet {
                index.entries.forEachIndexed { i, (thread, messages) ->
                    if (i > 0) RowDivider()
                    val contact = thread.contact(rules)
                    val title = historyTitle(thread, contact)
                    val last = messages.first()
                    val unread = messages.any { !it.outgoing && !it.read }
                    val readOnly = (contact == null && !thread.canCompose(rules)) || thread.kind == SmsThreadKind.LEGACY
                    val newWord = stringResource(R.string.messages_new)
                    val parent = contact != null && (PhoneNumbers.normalize(contact.number, rules.country) ?: contact.number) in parents
                    PersonRow(
                        title,
                        initial = if (thread.kind == SmsThreadKind.MMS || contact == null) "#" else title,
                        emphasis = parent,
                        titleWeight = if (unread) FontWeight.Bold else FontWeight.Normal,
                        onClick = { onOpen(thread) },
                        modifier = if (unread) Modifier.semantics { contentDescription = "$title, $newWord" } else Modifier,
                        aside = {
                            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                if (unread) Box(Modifier.size(10.dp).background(MaterialTheme.colorScheme.onSurface, CircleShape))
                                Text(shortWhen(context, last.atMs), style = MonoSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        },
                        lines = {
                            if (last.body.isNotBlank()) Text(
                                last.body,
                                style = MaterialTheme.typography.bodyMedium,
                                color = if (unread) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                            if (readOnly) Secondary(stringResource(R.string.history_read_only), style = MaterialTheme.typography.bodySmall)
                        },
                    )
                }
            }
        }
        if (!loading && (failed || hasMore)) item { MoreHistory(failed, onMore) }
        if (index.isNotEmpty()) item { Footnote(stringResource(R.string.messages_footnote)) }
    }
}

/**
 * One conversation. Bubbles from the child are ink, the others sit on a sheet. Each message the
 * child sent says where it is: sending, sent, or not sent with "Write it again". A conversation
 * the child cannot answer explains why instead of showing a text field.
 */
@Composable
internal fun ConversationScreen(
    contact: ApprovedContact?,
    refresh: Int,
    resumed: Int,
    thread: SmsThread,
    initialDraft: String,
    onBack: () -> Unit,
    onCall: (String) -> Unit,
    listState: LazyListState = rememberLazyListState(),
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var draft by rememberSaveable(thread) { mutableStateOf(initialDraft) }
    var error by remember { mutableStateOf<String?>(null) }
    val sendFailed = stringResource(R.string.message_send_failed)
    var messages by remember(thread) { mutableStateOf(emptyList<SmsMessage>()) }
    var after by remember(thread) { mutableStateOf<SmsMessage?>(null) }
    var loadedFor by remember(thread) { mutableStateOf<Pair<Int, Int>?>(null) }
    var request by remember(thread) { mutableIntStateOf(0) }
    var hasMore by remember(thread) { mutableStateOf(false) }
    var failed by remember(thread) { mutableStateOf(false) }
    var loading by remember(thread) { mutableStateOf(false) }
    LaunchedEffect(refresh, resumed, request) {
        val refreshKey = refresh to resumed
        loading = true
        failed = false
        suspend fun readPage(cursor: SmsMessage?, size: Int = HISTORY_PAGE_SIZE + 1) = withContext(Dispatchers.IO) {
            SmsStore.messagePage(context, thread, cursor, size)
        }
        try {
            val read = mutableListOf<SmsMessage>()
            if (loadedFor != refreshKey) {
                val newestLoaded = messages.firstOrNull()
                var cursor: SmsMessage? = null
                var more: Boolean
                do {
                    val page = readPage(cursor)
                    read += page.take(HISTORY_PAGE_SIZE)
                    more = page.size > HISTORY_PAGE_SIZE
                    cursor = read.lastOrNull()
                } while (more && cursor != null && newestLoaded != null &&
                    smsHistoryOrder.compare(cursor, newestLoaded) < 0)
                val merged = mergeSmsHistory(messages, read)
                val oldest = merged.lastOrNull()
                hasMore = more && (oldest == cursor || readPage(oldest, 1).isNotEmpty())
                messages = merged
                loadedFor = refreshKey
            }
            after?.let { start ->
                val page = readPage(start)
                val shown = page.take(HISTORY_PAGE_SIZE)
                read += shown
                messages = mergeSmsHistory(messages, shown)
                hasMore = page.size > HISTORY_PAGE_SIZE
                after = null
            }
            if (read.isNotEmpty()) withContext(Dispatchers.IO) {
                SmsStore.markRead(context, read)
                if (thread.kind != SmsThreadKind.LEGACY && thread.kind != SmsThreadKind.MMS) {
                    CallNotifications.cancelMessage(context, thread)
                }
            }
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            failed = true
        } finally {
            loading = false
        }
    }

    val canWrite = contact != null && thread.kind != SmsThreadKind.LEGACY
    Column(Modifier.fillMaxSize().statusBarsPadding().navigationBarsPadding().imePadding()) {
        ConversationTopBar(
            historyTitle(thread, contact),
            subtitle = if (contact != null && contact.name != contact.number && thread.kind == SmsThreadKind.CONTACT) contact.number else null,
            onBack = onBack,
            callDescription = contact?.takeIf { thread.kind != SmsThreadKind.LEGACY }?.let { stringResource(R.string.action_call, it.name) },
            onCall = { contact?.let { onCall(it.number) } },
        )
        LazyColumn(
            state = listState,
            reverseLayout = true,
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            items(messages.size, key = { messages[it].id }) { i ->
                val m = messages[i]
                val older = messages.getOrNull(i + 1)
                // The list runs bottom-up: the day goes above the first message of each day.
                Column {
                    if (older == null || dayOf(m.atMs) != dayOf(older.atMs)) DayLabel(m.atMs)
                    Bubble(
                        m,
                        onRetry = if (m.failed && m.outgoing && m.body.isNotBlank() && canWrite) ({ draft = draftAfterRetry(draft, m.body) }) else null,
                    )
                }
            }
            if (!loading && (hasMore || failed)) item {
                MoreHistory(failed) {
                    if (!failed) after = messages.lastOrNull()
                    request++
                }
            }
        }
        if (!canWrite) {
            Notice(
                stringResource(
                    when {
                        thread.kind == SmsThreadKind.MMS -> R.string.conversation_read_only_mms
                        thread.kind == SmsThreadKind.LEGACY -> R.string.conversation_read_only_help
                        else -> R.string.conversation_read_only_unknown
                    },
                ),
                Modifier.padding(bottom = 12.dp),
            )
            return@Column
        }
        error?.let {
            Text(
                it,
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp).semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
        Composer(
            draft = draft,
            onDraft = { draft = it },
            hint = stringResource(R.string.message_hint_to, contact!!.name),
            onSend = {
                val text = draft
                scope.launch {
                    val decision = withContext(Dispatchers.IO) { SmsSender.send(context, contact.number, text, thread.kind) }
                    if (decision.allowed) {
                        draft = ""
                        error = null
                    } else {
                        error = sendFailed
                    }
                }
            },
        )
    }
}

private fun dayOf(ms: Long): Long = java.util.Calendar.getInstance().run {
    timeInMillis = ms
    get(java.util.Calendar.YEAR) * 1000L + get(java.util.Calendar.DAY_OF_YEAR)
}

@Composable
private fun DayLabel(atMs: Long) {
    val context = LocalContext.current
    val text = if (DateUtils.isToday(atMs)) stringResource(R.string.when_today) else shortWhen(context, atMs)
    Text(
        text,
        style = MaterialTheme.typography.labelMedium,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        textAlign = TextAlign.Center,
        modifier = Modifier.fillMaxWidth().padding(vertical = 8.dp).semantics { heading() },
    )
}

/** Back, the name (with the number under it) and a call button. */
@Composable
internal fun ConversationTopBar(
    title: String, subtitle: String?, onBack: () -> Unit,
    callDescription: String? = null, onCall: () -> Unit = {},
    /** A phone number: mono. Words are not. */
    subtitleIsNumber: Boolean = true,
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 4.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        IconButton(onClick = onBack, modifier = Modifier.size(48.dp)) {
            Icon(PlainIcons.Back, contentDescription = stringResource(R.string.action_back))
        }
        Column(Modifier.weight(1f).padding(horizontal = 8.dp)) {
            Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold, modifier = Modifier.semantics { heading() })
            if (subtitle != null) Text(
                subtitle,
                style = if (subtitleIsNumber) MonoSmall else MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (callDescription != null) Box(Modifier.padding(end = 8.dp)) { CallButton(callDescription, onCall) }
    }
}

/** The text field and the ink send button on a sheet at the bottom. */
@Composable
internal fun Composer(draft: String, onDraft: (String) -> Unit, hint: String, onSend: () -> Unit) {
    val t = plainTokens
    Surface(color = t.sheet, border = BorderStroke(1.dp, t.divider)) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 10.dp), verticalAlignment = Alignment.Bottom) {
            OutlinedTextField(
                value = draft,
                onValueChange = onDraft,
                modifier = Modifier.weight(1f),
                placeholder = { Text(hint) },
                shape = RoundedCornerShape(24.dp),
                maxLines = 5,
                colors = OutlinedTextFieldDefaults.colors(unfocusedBorderColor = t.outline, focusedBorderColor = t.ink),
            )
            Spacer(Modifier.size(8.dp))
            FilledIconButton(
                onClick = onSend,
                enabled = draft.isNotBlank(),
                modifier = Modifier.size(56.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = AnswerFill, contentColor = OnAnswer),
            ) { Icon(PlainIcons.Send, contentDescription = stringResource(R.string.action_send)) }
        }
    }
}

/**
 * One message. The child's own are ink with paper text; the others are on a sheet. The line under
 * an own message says where it is: sending, sent at a time, or not sent (red, with the action).
 */
@Composable
internal fun Bubble(m: SmsMessage, onRetry: (() -> Unit)? = null) {
    val context = LocalContext.current
    val t = plainTokens
    val own = m.outgoing
    Column(Modifier.fillMaxWidth(), horizontalAlignment = if (own) Alignment.End else Alignment.Start) {
        Surface(
            shape = RoundedCornerShape(20.dp, 20.dp, if (own) 6.dp else 20.dp, if (own) 20.dp else 6.dp),
            color = if (own) t.answerSolid else t.sheet,
            contentColor = if (own) t.onAnswerSolid else t.ink,
            border = if (own) null else BorderStroke(1.dp, t.divider),
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            Box(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                if (m.id < 0) Text(stringResource(R.string.history_mms_placeholder), style = MaterialTheme.typography.bodyLarge)
                else MessageBody(m.body, linkColor = if (own) t.onAnswerSolid else t.ink)
            }
        }
        val status = when {
            !own -> clockTime(context, m.atMs)
            m.failed -> stringResource(R.string.message_failed)
            m.pending -> stringResource(R.string.message_sending)
            else -> stringResource(R.string.message_sent_at, clockTime(context, m.atMs))
        }
        Row(
            Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            if (own && !m.failed && !m.pending) Icon(PlainIcons.Check, contentDescription = null, modifier = Modifier.size(14.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(
                status,
                style = if (m.failed) MaterialTheme.typography.labelMedium.copy(fontWeight = FontWeight.Bold) else MonoSmall,
                color = if (m.failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (onRetry != null) TextButton(onClick = onRetry, modifier = Modifier.heightIn(min = 48.dp)) {
            Text(stringResource(R.string.message_retry), fontWeight = FontWeight.Bold)
        }
    }
}

/** The text of a message. Links to help sites open; other links are plain text. */
@Composable
internal fun MessageBody(body: String, linkColor: androidx.compose.ui.graphics.Color = MaterialTheme.colorScheme.primary) {
    val context = LocalContext.current
    val links = remember(context) { HelpLinks(context) }
    val text = remember(body, links, linkColor) {
        buildAnnotatedString {
            append(body)
            val matches = android.util.Patterns.WEB_URL.matcher(body)
            while (matches.find()) {
                val intent = links.intent(context, matches.group()) ?: continue
                addLink(
                    LinkAnnotation.Clickable(
                        tag = "help",
                        styles = TextLinkStyles(style = SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)),
                        linkInteractionListener = { context.startActivity(intent) },
                    ),
                    matches.start(),
                    matches.end(),
                )
            }
        }
    }
    Text(text, style = MaterialTheme.typography.bodyLarge)
}
