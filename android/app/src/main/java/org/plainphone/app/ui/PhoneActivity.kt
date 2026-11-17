// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.Manifest
import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.CallLog
import android.telecom.TelecomManager
import android.text.format.DateUtils
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.EmergencyNumbers
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.telephony.CallNotifications
import org.plainphone.app.telephony.SmsMessage
import org.plainphone.app.telephony.SmsSender
import org.plainphone.app.telephony.SmsStore

enum class Tab { CONTACTS, RECENTS, MESSAGES, KEYPAD }

/** What an incoming intent asks the screen to show. */
data class Route(val tab: Tab, val number: String? = null, val body: String? = null, val nonce: Long = System.nanoTime())

/**
 * The phone and messages app: approved contacts, recent calls, conversations
 * and a keypad. Also the default handler for DIAL and SENDTO (sms/smsto/mms/mmsto),
 * which the phone and SMS roles require.
 */
class PhoneActivity : ComponentActivity() {
    private var route by mutableStateOf(Route(Tab.CONTACTS))
    private var resumed by mutableIntStateOf(0)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        CallNotifications.createChannels(this)
        route = routeFor(intent)
        setContent { PlainphoneTheme { PhoneApp(route, resumed) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        route = routeFor(intent)
    }

    override fun onResume() {
        super.onResume()
        resumed++ // Reload rules and lists: the parent may have changed them.
    }

    private fun routeFor(intent: Intent?): Route {
        val data = intent?.data
        val number = data?.schemeSpecificPart?.substringBefore('?')?.takeIf { it.isNotBlank() }
        val body = intent?.getStringExtra("sms_body") ?: intent?.getStringExtra(Intent.EXTRA_TEXT)
        return when {
            intent?.getStringExtra(EXTRA_CONVERSATION) != null ->
                Route(Tab.MESSAGES, intent.getStringExtra(EXTRA_CONVERSATION))
            intent?.action == Intent.ACTION_SENDTO || intent?.action == Intent.ACTION_SEND -> Route(Tab.MESSAGES, number, body)
            intent?.action == Intent.ACTION_DIAL || (intent?.action == Intent.ACTION_VIEW && data?.scheme == "tel") ->
                Route(Tab.KEYPAD, number)
            intent?.component?.className?.endsWith(MESSAGES_ALIAS) == true -> Route(Tab.MESSAGES)
            else -> Route(Tab.CONTACTS)
        }
    }

    companion object {
        const val EXTRA_CONVERSATION = "org.plainphone.app.CONVERSATION"
        private const val MESSAGES_ALIAS = ".MessagesLauncher"

        fun conversationIntent(context: Context, number: String): Intent =
            Intent(context, PhoneActivity::class.java)
                .putExtra(EXTRA_CONVERSATION, number)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}

/** Starts a call if the contacts rule allows it. Returns null on success, else a message for the user. */
fun placeCall(context: Context, number: String): String? {
    if (!EmergencyNumbers.forContext(context).isEmergency(number)) {
        val decision = context.contactPolicy().decide(
            ContactPolicySources.get(context).rules(), Channel.CALL, Direction.OUTGOING, number,
        )
        if (!decision.allowed) {
            TelephonyLog(context).recordBlocked(Channel.CALL, Direction.OUTGOING, number)
            return context.getString(R.string.call_not_allowed)
        }
    }
    if (context.checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
        return context.getString(R.string.call_no_permission)
    }
    return runCatching {
        context.getSystemService(TelecomManager::class.java).placeCall(Uri.fromParts("tel", number, null), Bundle())
        null
    }.getOrElse { context.getString(R.string.call_failed) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PhoneApp(route: Route, resumed: Int) {
    val context = LocalContext.current
    var tab by remember(route) { mutableStateOf(route.tab) }
    var conversationWith by remember(route) { mutableStateOf<String?>(if (route.tab == Tab.MESSAGES) route.number else null) }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val rules by produceState(initialValue = ContactRules(false, emptyList(), null), resumed) {
        value = withContext(Dispatchers.IO) { ContactPolicySources.get(context).rules() }
    }
    val call: (String) -> Unit = { number ->
        placeCall(context, number)?.let { msg -> scope.launch { snackbar.showSnackbar(msg) } }
    }

    val open = conversationWith
    if (open != null) {
        BackHandler { conversationWith = null }
        val contact = rules.contactFor(open)
        ConversationScreen(
            contact = contact,
            rawNumber = open,
            initialDraft = route.body.takeIf { route.number == open }.orEmpty(),
            onBack = { conversationWith = null },
            onCall = call,
        )
        return
    }

    Scaffold(
        topBar = { TopAppBar(title = { Text(stringResource(tab.title()), fontWeight = FontWeight.SemiBold) }) },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = t == tab,
                        onClick = { tab = t },
                        icon = { Icon(t.icon(), contentDescription = null) },
                        label = { Text(stringResource(t.title())) },
                    )
                }
            }
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            RoleBanner(resumed)
            when (tab) {
                Tab.CONTACTS -> ContactsScreen(rules, onCall = call, onMessage = { conversationWith = it.number })
                Tab.RECENTS -> RecentsScreen(rules, resumed, onCall = call)
                Tab.MESSAGES -> ConversationsScreen(resumed, onOpen = { conversationWith = it })
                Tab.KEYPAD -> KeypadScreen(initial = route.number.takeIf { route.tab == Tab.KEYPAD }.orEmpty(), onCall = call)
            }
        }
    }
}

private fun Tab.title() = when (this) {
    Tab.CONTACTS -> R.string.tab_contacts
    Tab.RECENTS -> R.string.tab_recents
    Tab.MESSAGES -> R.string.tab_messages
    Tab.KEYPAD -> R.string.tab_keypad
}

private fun Tab.icon() = when (this) {
    Tab.CONTACTS -> Icons.Filled.Person
    Tab.RECENTS -> Icons.AutoMirrored.Filled.List
    Tab.MESSAGES -> Icons.Filled.Email
    Tab.KEYPAD -> Icons.Filled.Phone
}

/** Shown when Plainphone is not yet the phone and SMS app (installed by hand, not by QR). */
@Composable
private fun RoleBanner(resumed: Int) {
    val context = LocalContext.current
    val roles = context.getSystemService(RoleManager::class.java)
    var refresh by remember { mutableIntStateOf(0) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { refresh++ }
    val missing = remember(resumed, refresh) {
        listOf(RoleManager.ROLE_DIALER, RoleManager.ROLE_SMS).filter { roles?.isRoleHeld(it) == false && roles.isRoleAvailable(it) }
    }
    if (missing.isEmpty()) return
    Card(
        modifier = Modifier.fillMaxWidth().padding(16.dp),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text(stringResource(R.string.role_banner_text), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(8.dp))
            Button(onClick = { launcher.launch(roles.createRequestRoleIntent(missing.first())) }) {
                Text(stringResource(if (missing.first() == RoleManager.ROLE_DIALER) R.string.role_make_phone else R.string.role_make_sms))
            }
        }
    }
}

@Composable
private fun ContactsScreen(rules: ContactRules, onCall: (String) -> Unit, onMessage: (ApprovedContact) -> Unit) {
    if (rules.contacts.isEmpty()) {
        EmptyState(stringResource(R.string.contacts_empty))
        return
    }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        items(rules.contacts, key = { it.number }) { c ->
            Row(
                Modifier.fillMaxWidth().clickable { onCall(c.number) }.padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Initial(c.name)
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    Text(c.name, style = MaterialTheme.typography.titleMedium)
                    Text(c.number, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                IconButton(onClick = { onMessage(c) }) {
                    Icon(Icons.Filled.Email, contentDescription = stringResource(R.string.action_message, c.name))
                }
                FilledIconButton(onClick = { onCall(c.number) }) {
                    Icon(Icons.Filled.Call, contentDescription = stringResource(R.string.action_call, c.name))
                }
            }
        }
        item { Footnote(stringResource(R.string.contacts_footnote)) }
    }
}

private data class RecentCall(val number: String, val type: Int, val atMs: Long)

@Composable
private fun RecentsScreen(rules: ContactRules, resumed: Int, onCall: (String) -> Unit) {
    val context = LocalContext.current
    val calls by produceState<List<RecentCall>?>(null, resumed) {
        value = withContext(Dispatchers.IO) { readRecentCalls(context) }
    }
    val list = calls ?: return
    if (list.isEmpty()) {
        EmptyState(stringResource(R.string.recents_empty))
        return
    }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        items(list) { r ->
            val name = rules.contactFor(r.number)?.name ?: r.number
            val kind = when (r.type) {
                CallLog.Calls.INCOMING_TYPE -> R.string.recent_incoming
                CallLog.Calls.OUTGOING_TYPE -> R.string.recent_outgoing
                CallLog.Calls.MISSED_TYPE -> R.string.recent_missed
                else -> R.string.recent_other
            }
            Row(
                Modifier.fillMaxWidth().clickable { onCall(r.number) }.padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Initial(name, 40.dp)
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    Text(
                        name,
                        style = MaterialTheme.typography.titleMedium,
                        color = if (r.type == CallLog.Calls.MISSED_TYPE) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                    )
                    Text(
                        stringResource(kind) + ", " + DateUtils.getRelativeTimeSpanString(r.atMs),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                Icon(Icons.Filled.Call, contentDescription = stringResource(R.string.action_call, name), tint = MaterialTheme.colorScheme.primary)
            }
        }
    }
}

private fun readRecentCalls(context: Context): List<RecentCall> {
    if (context.checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return emptyList()
    val out = mutableListOf<RecentCall>()
    runCatching {
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE),
            null, null, "${CallLog.Calls.DATE} DESC LIMIT 100",
        )?.use { c ->
            while (c.moveToNext()) out += RecentCall(c.getString(0).orEmpty(), c.getInt(1), c.getLong(2))
        }
    }
    return out
}

@Composable
private fun ConversationsScreen(resumed: Int, onOpen: (String) -> Unit) {
    val context = LocalContext.current
    val changes by SmsStore.changes.collectAsState()
    val conversations by produceState<List<org.plainphone.app.telephony.Conversation>?>(null, resumed, changes) {
        value = withContext(Dispatchers.IO) { SmsStore.conversations(context) }
    }
    val list = conversations ?: return
    if (list.isEmpty()) {
        EmptyState(stringResource(R.string.messages_empty))
        return
    }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        items(list, key = { it.contact.number }) { conv ->
            Row(
                Modifier.fillMaxWidth().clickable { onOpen(conv.contact.number) }.padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Initial(conv.contact.name)
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    Text(
                        conv.contact.name,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = if (conv.unread > 0) FontWeight.Bold else FontWeight.Normal,
                    )
                    Text(
                        conv.last.body,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                }
                Text(
                    DateUtils.getRelativeTimeSpanString(conv.last.atMs).toString(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        item { Footnote(stringResource(R.string.messages_footnote)) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ConversationScreen(
    contact: ApprovedContact?,
    rawNumber: String,
    initialDraft: String,
    onBack: () -> Unit,
    onCall: (String) -> Unit,
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val changes by SmsStore.changes.collectAsState()
    var draft by remember(rawNumber) { mutableStateOf(initialDraft) }
    var error by remember { mutableStateOf<String?>(null) }
    val sendFailed = stringResource(R.string.message_send_failed)
    val messages by produceState<List<SmsMessage>>(emptyList(), contact, changes) {
        value = if (contact == null) emptyList() else withContext(Dispatchers.IO) {
            SmsStore.thread(context, contact).also {
                SmsStore.markRead(context, it)
                CallNotifications.cancelMessage(context, contact.number)
            }
        }
    }
    val listState = rememberLazyListState()
    LaunchedEffect(messages.size) { if (messages.isNotEmpty()) listState.scrollToItem(messages.lastIndex) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(contact?.name ?: rawNumber, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                actions = {
                    if (contact != null) {
                        IconButton(onClick = { onCall(contact.number) }) {
                            Icon(Icons.Filled.Call, contentDescription = stringResource(R.string.action_call, contact.name))
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().imePadding()) {
            if (contact == null) {
                Box(Modifier.weight(1f)) { EmptyState(stringResource(R.string.message_not_approved, rawNumber)) }
                return@Column
            }
            LazyColumn(
                state = listState,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(messages, key = { it.id }) { Bubble(it) }
            }
            error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp))
            }
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                OutlinedTextField(
                    value = draft,
                    onValueChange = { draft = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text(stringResource(R.string.message_hint)) },
                    shape = RoundedCornerShape(24.dp),
                    maxLines = 5,
                )
                Spacer(Modifier.size(8.dp))
                FilledIconButton(
                    onClick = {
                        val text = draft
                        scope.launch {
                            val decision = withContext(Dispatchers.IO) { SmsSender.send(context, contact.number, text) }
                            if (decision.allowed) {
                                draft = ""
                                error = null
                            } else {
                                error = sendFailed
                            }
                        }
                    },
                    enabled = draft.isNotBlank(),
                ) {
                    Icon(Icons.AutoMirrored.Filled.Send, contentDescription = stringResource(R.string.action_send))
                }
            }
        }
    }
}

@Composable
private fun Bubble(m: SmsMessage) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (m.outgoing) Arrangement.End else Arrangement.Start) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = if (m.outgoing) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                Text(m.body, style = MaterialTheme.typography.bodyLarge)
                Text(
                    if (m.failed) stringResource(R.string.message_failed) else DateUtils.getRelativeTimeSpanString(m.atMs).toString(),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (m.failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

@Composable
private fun KeypadScreen(initial: String, onCall: (String) -> Unit) {
    var number by remember(initial) { mutableStateOf(initial) }
    Column(
        Modifier.fillMaxSize().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            number.ifEmpty { " " },
            fontSize = 34.sp,
            fontWeight = FontWeight.Light,
            maxLines = 1,
            modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp),
            textAlign = TextAlign.Center,
        )
        Text(
            stringResource(R.string.keypad_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(16.dp))
        Keypad(onKey = { number += it }, modifier = Modifier.widthIn(max = 320.dp))
        Spacer(Modifier.height(16.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.size(64.dp))
            FilledIconButton(
                onClick = { if (number.isNotBlank()) onCall(number) },
                modifier = Modifier.size(72.dp),
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = AnswerGreen),
            ) {
                Icon(Icons.Filled.Call, contentDescription = stringResource(R.string.action_call, number), modifier = Modifier.size(32.dp))
            }
            TextButton(onClick = { number = number.dropLast(1) }, modifier = Modifier.size(64.dp)) {
                Text("⌫", fontSize = 22.sp)
            }
        }
    }
}

/** 3x4 phone keypad, shared by the keypad tab and the in-call screen (DTMF). */
@Composable
fun Keypad(onKey: (Char) -> Unit, modifier: Modifier = Modifier) {
    val rows = listOf("123", "456", "789", "*0#")
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { key ->
                    Surface(
                        onClick = { onKey(key) },
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.weight(1f).aspectRatio(1.4f),
                    ) {
                        Box(contentAlignment = Alignment.Center) { Text(key.toString(), fontSize = 26.sp) }
                    }
                }
            }
        }
    }
}

@Composable
private fun EmptyState(text: String) {
    Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) {
        Text(
            text,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}

@Composable
private fun Footnote(text: String) {
    Column {
        HorizontalDivider(Modifier.padding(top = 8.dp))
        Text(
            text,
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(20.dp),
        )
    }
}
