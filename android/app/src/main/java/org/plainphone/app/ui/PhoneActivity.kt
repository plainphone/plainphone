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
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.List
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Call
import androidx.compose.material.icons.filled.Email
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material3.AlertDialog
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
import androidx.compose.runtime.key
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
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
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import org.plainphone.app.ConfigStore
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.DeviceContacts
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.Sync
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.contacts.EmergencyNumbers
import org.plainphone.app.contacts.HelpReplies
import org.plainphone.app.contacts.HelpLinks
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.telephony.CallNotifications
import org.plainphone.app.telephony.SmsMessage
import org.plainphone.app.telephony.SmsSender
import org.plainphone.app.telephony.SmsStore
import org.plainphone.app.telephony.mergeSmsHistory
import org.plainphone.app.telephony.smsHistoryOrder
import org.plainphone.app.telephony.SmsThread
import org.plainphone.app.telephony.SmsThreadKind
import org.plainphone.app.telephony.ThreadCursor
import org.plainphone.app.telephony.ThreadPage

enum class Tab { CONTACTS, RECENTS, MESSAGES, KEYPAD }

/** What an incoming intent asks the screen to show. */
data class Route(
    val tab: Tab,
    val number: String? = null,
    val body: String? = null,
    val nonce: Long = System.nanoTime(),
    val threadKind: SmsThreadKind? = null,
)

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
                Route(
                    Tab.MESSAGES, intent.getStringExtra(EXTRA_CONVERSATION),
                    threadKind = SmsThreadKind.entries.firstOrNull { it.name == intent.getStringExtra(EXTRA_THREAD_KIND) }
                        ?: SmsThreadKind.CONTACT,
                )
            intent?.action == Intent.ACTION_SENDTO || intent?.action == Intent.ACTION_SEND -> Route(Tab.MESSAGES, number, body)
            intent?.action == Intent.ACTION_DIAL || (intent?.action == Intent.ACTION_VIEW && data?.scheme == "tel") ->
                Route(Tab.KEYPAD, number)
            intent?.component?.className?.endsWith(MESSAGES_ALIAS) == true -> Route(Tab.MESSAGES)
            else -> Route(Tab.CONTACTS)
        }
    }

    companion object {
        const val EXTRA_CONVERSATION = "org.plainphone.app.CONVERSATION"
        private const val EXTRA_THREAD_KIND = "org.plainphone.app.THREAD_KIND"
        private const val MESSAGES_ALIAS = ".MessagesLauncher"

        fun favouritesIntent(context: Context): Intent = Intent(context, PhoneActivity::class.java)

        fun conversationIntent(context: Context, thread: SmsThread): Intent =
            Intent(context, PhoneActivity::class.java)
                .putExtra(EXTRA_CONVERSATION, thread.number)
                .putExtra(EXTRA_THREAD_KIND, thread.kind.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    }
}

/** Starts a call if the contacts rule allows it. Returns null on success, else a message for the user. */
fun placeCall(context: Context, number: String): String? {
    val rules = if (EmergencyNumbers.forContext(context).isEmergency(number)) null
        else ContactPolicySources.get(context).rules()
    if (rules != null) {
        val decision = context.contactPolicy().decide(
            rules, Channel.CALL, Direction.OUTGOING, number,
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
        rules?.replyHelpContact(number, Channel.CALL)?.let { HelpReplies(context).record(Channel.CALL, it.number) }
        null
    }.getOrElse { context.getString(R.string.call_failed) }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun PhoneApp(route: Route, resumed: Int) {
    val context = LocalContext.current
    var tab by remember(route) { mutableStateOf(route.tab) }
    val threadListState = rememberLazyListState()
    var conversationWith by remember(route) {
        mutableStateOf(
            route.number?.takeIf { route.tab == Tab.MESSAGES }
                ?.let { SmsThread(it, route.threadKind ?: SmsThreadKind.CONTACT) },
        )
    }
    val snackbar = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    var refreshRules by remember { mutableIntStateOf(0) }
    val rules by produceState(initialValue = ContactRules(true, emptyList(), null), resumed, refreshRules) {
        do {
            value = withContext(Dispatchers.IO) { ContactPolicySources.get(context).rules() }
            delay(15_000)
        } while (value.selfProfile)
    }
    val call: (String) -> Unit = { number ->
        placeCall(context, number)?.let { msg -> scope.launch { snackbar.showSnackbar(msg) } }
    }

    val open = conversationWith
    val changes by SmsStore.changes.collectAsState()
    var threadPage by remember { mutableStateOf<ThreadPage?>(null) }
    var historyFailed by remember { mutableStateOf(false) }
    var threadRequest by remember { mutableIntStateOf(0) }
    var threadAfter by remember(tab, open, resumed, changes) { mutableStateOf<ThreadCursor?>(null) }
    var historyLoading by remember { mutableStateOf(false) }
    LaunchedEffect(threadRequest, tab, open, resumed, changes) {
        if (tab != Tab.MESSAGES || open != null) return@LaunchedEffect
        val after = threadAfter
        historyLoading = true
        historyFailed = false
        try {
            val next = withContext(Dispatchers.IO) { SmsStore.threadPage(context, after, HISTORY_PAGE_SIZE) }
            threadPage = if (after == null) next else next.copy(threads = threadPage?.threads.orEmpty() + next.threads)
        } catch (error: Exception) {
            if (error is kotlinx.coroutines.CancellationException) throw error
            historyFailed = true
        } finally {
            historyLoading = false
        }
    }
    if (open != null) {
        BackHandler { conversationWith = null }
        val destination = if (route.tab == Tab.MESSAGES && route.number == open.number && route.threadKind == null &&
            open.kind == SmsThreadKind.CONTACT && open.contact(rules) == null &&
            rules.helpContact(open.number, Channel.SMS) != null
        ) {
            open.copy(kind = SmsThreadKind.HELP)
        } else open
        val thread = if (destination.kind == SmsThreadKind.CONTACT) {
            destination.copy(number = PhoneNumbers.normalize(destination.number, rules.country) ?: destination.number)
        } else destination
        val contact = thread.contact(rules) ?: if (thread.canCompose(rules)) ApprovedContact(thread.number, thread.number) else null
        key(thread) {
            ConversationScreen(
                contact = contact,
                refresh = changes,
                resumed = resumed,
                thread = thread,
                initialDraft = route.body.takeIf { route.number == open.number }.orEmpty(),
                onBack = { conversationWith = null },
                onCall = call,
            )
        }
        return
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(tab.title()), fontWeight = FontWeight.SemiBold) },
                actions = {
                    if (tab == Tab.MESSAGES) NewMessageAction(rules) { conversationWith = it }
                },
            )
        },
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
            androidx.compose.material3.TextButton(onClick = {
                context.startActivity(Intent(context, org.plainphone.app.contacts.HelpActivity::class.java))
            }) { Text(stringResource(R.string.help_lines_title)) }
            when (tab) {
                Tab.CONTACTS -> ContactsScreen(
                    rules, resumed, onRulesChanged = { refreshRules++ },
                    onCall = call, onMessage = { conversationWith = SmsThread(it.number) },
                )
                Tab.RECENTS -> RecentsScreen(rules, resumed, onCall = call)
                Tab.MESSAGES -> {
                    org.plainphone.app.sos.ChildQuickMessages(
                        withSuggest = false,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp),
                    )
                    ConversationsScreen(
                        rules, threadPage?.threads, threadListState,
                        hasMore = threadPage?.next != null,
                        failed = historyFailed,
                        loading = historyLoading,
                        onMore = {
                            if (!historyFailed) threadAfter = threadPage?.next
                            threadRequest++
                        },
                        onOpen = { conversationWith = it },
                    )
                }
                Tab.KEYPAD -> KeypadScreen(
                    initial = route.number.takeIf { route.tab == Tab.KEYPAD }.orEmpty(),
                    onCall = call,
                    onParents = { tab = Tab.CONTACTS },
                    showParents = !rules.selfProfile,
                    onEmergency = { org.plainphone.app.sos.openEmergencyDialer(context) },
                )
            }
        }
    }
}

@Composable
internal fun NewMessageAction(rules: ContactRules, onOpen: (SmsThread) -> Unit) {
    if ((!rules.selfProfile && !rules.childProfile) || rules.enforced) return
    var open by remember { mutableStateOf(false) }
    val title = stringResource(R.string.message_new)
    TextButton(onClick = { open = true }) { Text(title) }
    if (!open) return
    var number by remember { mutableStateOf("") }
    val destination = SmsThread(PhoneNumbers.normalize(number, rules.country) ?: number.trim())
    AlertDialog(
        onDismissRequest = { open = false },
        title = { Text(title) },
        text = {
            OutlinedTextField(
                value = number,
                onValueChange = { number = it },
                label = { Text(stringResource(R.string.contacts_admin_number)) },
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                singleLine = true,
            )
        },
        confirmButton = {
            TextButton(
                enabled = destination.canCompose(rules),
                onClick = {
                    open = false
                    onOpen(destination)
                },
            ) { Text(stringResource(R.string.message_new_continue)) }
        },
        dismissButton = {
            TextButton(onClick = { open = false }) { Text(stringResource(android.R.string.cancel)) }
        },
    )
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
internal fun ContactsScreen(
    rules: ContactRules, resumed: Int, onRulesChanged: () -> Unit,
    onCall: (String) -> Unit, onMessage: (ApprovedContact) -> Unit,
) {
    val context = LocalContext.current
    var permissionRefresh by remember { mutableIntStateOf(0) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        permissionRefresh++
        if (granted && rules.suggestDeviceContacts) SyncScheduler.now(context, "contact permission granted")
    }
    val canRead = remember(resumed, permissionRefresh) { DeviceContacts.canRead(context) }
    val setupStore = remember { SyncStore(context) }
    var setupPhoneId by remember(rules.selfProfile) {
        mutableStateOf(if (rules.selfProfile) setupStore.favouriteSetupPhoneId() else null)
    }
    var choosing by remember(rules.selfProfile) {
        mutableStateOf(setupPhoneId != null)
    }
    fun finishChoosing() {
        setupPhoneId?.let(setupStore::completeFavouriteSetup)
        setupPhoneId = null
        choosing = false
    }
    val deviceContacts by produceState(emptyList<ApprovedContact>(), rules.selfProfile, rules.country, resumed, canRead) {
        value = if (rules.selfProfile && canRead) withContext(Dispatchers.IO) {
            DeviceContacts.read(context, rules.country).flatMap { contact ->
                contact.numbers.map { number -> ApprovedContact(contact.name, number) }
            }
        } else emptyList()
    }
    val list = remember(rules.contacts, deviceContacts, rules.selfProfile) {
        if (rules.selfProfile) (deviceContacts + rules.contacts).distinctBy { it.number } else rules.contacts
    }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Int?>(null) }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        if (rules.childProfile || rules.selfProfile) item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                if (rules.childProfile) {
                    Text(stringResource(if (rules.suggestDeviceContacts) R.string.contacts_child_sharing else R.string.contacts_child_sharing_off))
                }
                if (!canRead && (rules.selfProfile || rules.suggestDeviceContacts)) {
                    TextButton(onClick = { permission.launch(Manifest.permission.READ_CONTACTS) }) {
                        Text(stringResource(R.string.contacts_read_permission))
                    }
                }
                if (rules.selfProfile) {
                    TextButton(onClick = { if (choosing) finishChoosing() else choosing = true }) {
                        Text(stringResource(if (choosing) R.string.contacts_favourites_done else R.string.contacts_favourites_choose))
                    }
                    if (choosing) Text(stringResource(R.string.contacts_favourites_hint))
                    if (choosing && setupPhoneId != null) {
                        TextButton(onClick = ::finishChoosing) {
                            Text(stringResource(R.string.contacts_favourites_skip))
                        }
                    }
                    notice?.let { Text(stringResource(it), modifier = Modifier.padding(top = 8.dp)) }
                }
            }
        }
        if (list.isEmpty()) item {
            Footnote(stringResource(if (rules.selfProfile) R.string.contacts_self_empty else R.string.contacts_empty))
        }
        items(list, key = { it.number }) { c ->
            val favourite = rules.selfProfile && rules.contactFor(c.number) != null
            val canCall = context.contactPolicy().decide(rules, Channel.CALL, Direction.OUTGOING, c.number).allowed
            val canText = context.contactPolicy().decide(rules, Channel.SMS, Direction.OUTGOING, c.number).allowed
            Row(
                Modifier.fillMaxWidth()
                    .then(if (canCall && !choosing) Modifier.clickable { onCall(c.number) } else Modifier)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Initial(c.name)
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    Text(c.name, style = MaterialTheme.typography.titleMedium)
                    Text(c.number, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (favourite) Text(stringResource(R.string.contacts_favourite), style = MaterialTheme.typography.labelMedium)
                    if (!canCall && !canText && !choosing) {
                        Text(stringResource(R.string.history_read_only), style = MaterialTheme.typography.labelMedium)
                    }
                }
                if (choosing && rules.selfProfile && DeviceContacts.internationalNumber.matches(c.number)) {
                    val action = stringResource(if (favourite) R.string.contacts_favourite_remove else R.string.contacts_favourite_add)
                    TextButton(
                        enabled = !busy,
                        modifier = Modifier.semantics { contentDescription = "$action ${c.name}" },
                        onClick = {
                            busy = true
                            notice = null
                            scope.launch {
                                try {
                                    val applied = withContext(Dispatchers.IO) {
                                        val token = checkNotNull(SyncStore(context).deviceToken())
                                        PlainphoneApi(ConfigStore(context).load().serverUrl, context)
                                            .setFavourite(token, c, !favourite).also {
                                                Sync.runner(context).run("favourite changed")
                                            }
                                    }
                                    onRulesChanged()
                                    notice = if (applied) null else R.string.contacts_favourite_waiting
                                } catch (e: kotlinx.coroutines.CancellationException) {
                                    throw e
                                } catch (_: Exception) {
                                    notice = R.string.contacts_favourite_failed
                                } finally {
                                    busy = false
                                }
                            }
                        },
                    ) { Text(action) }
                } else if (!choosing) {
                    if (canText) IconButton(onClick = { onMessage(c) }) {
                        Icon(Icons.Filled.Email, contentDescription = stringResource(R.string.action_message, c.name))
                    }
                    if (canCall) FilledIconButton(onClick = { onCall(c.number) }) {
                        Icon(Icons.Filled.Call, contentDescription = stringResource(R.string.action_call, c.name))
                    }
                }
            }
        }
        if (!rules.selfProfile && rules.enforced && list.isNotEmpty()) item { Footnote(stringResource(R.string.contacts_footnote)) }
    }
}

private data class RecentCall(val number: String, val type: Int, val atMs: Long)

@Composable
internal fun RecentsScreen(rules: ContactRules, resumed: Int, onCall: (String) -> Unit) {
    val context = LocalContext.current
    val calls by produceState<List<RecentCall>?>(null, resumed) {
        value = withContext(Dispatchers.IO) { readRecentCalls(context) }
    }
    var visible by remember(resumed) { mutableIntStateOf(HISTORY_PAGE_SIZE) }
    val list = calls ?: return
    if (list.isEmpty()) {
        EmptyState(stringResource(R.string.recents_empty))
        return
    }
    LazyColumn(contentPadding = PaddingValues(vertical = 8.dp)) {
        items(list.take(visible)) { r ->
            val canCall = r.number.isNotBlank() && context.contactPolicy()
                .decide(rules, Channel.CALL, Direction.OUTGOING, r.number).allowed
            val name = rules.contactFor(r.number)?.name ?: r.number.ifBlank { stringResource(R.string.history_unknown) }
            val kind = when (r.type) {
                CallLog.Calls.INCOMING_TYPE -> R.string.recent_incoming
                CallLog.Calls.OUTGOING_TYPE -> R.string.recent_outgoing
                CallLog.Calls.MISSED_TYPE -> R.string.recent_missed
                else -> R.string.recent_other
            }
            Row(
                Modifier.fillMaxWidth().then(if (canCall) Modifier.clickable { onCall(r.number) } else Modifier).padding(horizontal = 20.dp, vertical = 12.dp),
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
                if (canCall) {
                    Icon(Icons.Filled.Call, contentDescription = stringResource(R.string.action_call, name), tint = MaterialTheme.colorScheme.primary)
                } else {
                    Text(stringResource(R.string.history_read_only), style = MaterialTheme.typography.labelMedium)
                }
            }
        }
        if (visible < list.size) item { MoreHistory { visible += HISTORY_PAGE_SIZE } }
    }
}

private fun readRecentCalls(context: Context): List<RecentCall> {
    if (context.checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return emptyList()
    val out = mutableListOf<RecentCall>()
    runCatching {
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE),
            null, null, "${CallLog.Calls.DATE} DESC",
        )?.use { c ->
            while (c.moveToNext()) out += RecentCall(c.getString(0).orEmpty(), c.getInt(1), c.getLong(2))
        }
    }
    return out
}

private const val HISTORY_PAGE_SIZE = 50

@Composable
private fun MoreHistory(retry: Boolean = false, onClick: () -> Unit) {
    if (retry) Footnote(stringResource(R.string.history_load_failed))
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth()) {
        Text(stringResource(if (retry) R.string.history_retry else R.string.history_load_older))
    }
}

private fun SmsThread.canCompose(rules: ContactRules): Boolean =
    kind == SmsThreadKind.CONTACT && (rules.selfProfile || rules.childProfile) && !rules.enforced &&
        android.telephony.PhoneNumberUtils.isGlobalPhoneNumber(number)

@Composable
private fun historyTitle(thread: SmsThread, contact: ApprovedContact?): String = when {
    thread.participants.isNotEmpty() -> thread.participants.joinToString()
    thread.kind == SmsThreadKind.MMS -> stringResource(R.string.history_mms)
    contact != null -> contact.name
    else -> thread.number.ifBlank { stringResource(R.string.history_unknown) }
}

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
) {
    val index = history.orEmpty()
    if (history != null && index.isEmpty() && !failed && !loading) {
        EmptyState(stringResource(R.string.messages_empty))
        return
    }
    LazyColumn(state = state, contentPadding = PaddingValues(vertical = 8.dp)) {
        items(index.entries.toList(), key = { "${it.key.kind}:${it.key.systemId ?: it.key.number}" }) { (thread, messages) ->
            val contact = thread.contact(rules)
            val title = historyTitle(thread, contact)
            val last = messages.first()
            Row(
                Modifier.fillMaxWidth().clickable { onOpen(thread) }.padding(horizontal = 20.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Initial(title)
                Column(Modifier.weight(1f).padding(horizontal = 16.dp)) {
                    Text(
                        title,
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = if (messages.any { !it.outgoing && !it.read }) FontWeight.Bold else FontWeight.Normal,
                    )
                    if ((contact == null && !thread.canCompose(rules)) || thread.kind == SmsThreadKind.LEGACY) {
                        Text(stringResource(R.string.history_read_only), style = MaterialTheme.typography.bodyMedium)
                    }
                    Text(
                        DateUtils.getRelativeTimeSpanString(last.atMs).toString(),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        if (!loading && (failed || hasMore)) item { MoreHistory(failed, onMore) }
        item { Footnote(stringResource(R.string.messages_footnote)) }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
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

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(historyTitle(thread, contact), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(R.string.action_back))
                    }
                },
                actions = {
                    if (contact != null && thread.kind != SmsThreadKind.LEGACY) {
                        IconButton(onClick = { onCall(contact.number) }) {
                            Icon(Icons.Filled.Call, contentDescription = stringResource(R.string.action_call, contact.name))
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize().imePadding()) {
            LazyColumn(
                state = listState,
                reverseLayout = true,
                modifier = Modifier.weight(1f).fillMaxWidth(),
                contentPadding = PaddingValues(16.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                items(messages, key = { it.id }) { m ->
                    Bubble(m, onRetry = if (m.failed && m.outgoing && m.body.isNotBlank() && contact != null && thread.kind != SmsThreadKind.LEGACY) ({ draft = draftAfterRetry(draft, m.body) }) else null)
                }
                if (!loading && (hasMore || failed)) item {
                    MoreHistory(failed) {
                        if (!failed) after = messages.lastOrNull()
                        request++
                    }
                }
            }
            if (contact == null || thread.kind == SmsThreadKind.LEGACY) {
                Footnote(stringResource(R.string.history_read_only))
                return@Column
            }
            error?.let {
                Text(
                    it,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(horizontal = 16.dp).semantics { liveRegion = LiveRegionMode.Polite },
                )
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
                            val decision = withContext(Dispatchers.IO) { SmsSender.send(context, contact.number, text, thread.kind) }
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
internal fun Bubble(m: SmsMessage, onRetry: (() -> Unit)? = null) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = if (m.outgoing) Arrangement.End else Arrangement.Start) {
        Surface(
            shape = RoundedCornerShape(18.dp),
            color = if (m.outgoing) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant,
            modifier = Modifier.widthIn(max = 300.dp),
        ) {
            Column(Modifier.padding(horizontal = 14.dp, vertical = 10.dp)) {
                if (m.id < 0) Text(stringResource(R.string.history_mms_placeholder)) else MessageBody(m.body)
                Text(
                    if (m.failed) stringResource(R.string.message_failed) else DateUtils.getRelativeTimeSpanString(m.atMs).toString(),
                    style = MaterialTheme.typography.labelSmall,
                    color = if (m.failed) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (onRetry != null) TextButton(onClick = onRetry) { Text(stringResource(R.string.message_retry)) }
            }
        }
    }
}

@Composable
internal fun MessageBody(body: String) {
    val context = LocalContext.current
    val color = MaterialTheme.colorScheme.primary
    val links = remember(context) { HelpLinks(context) }
    val text = remember(body, links, color) {
        buildAnnotatedString {
            append(body)
            val matches = android.util.Patterns.WEB_URL.matcher(body)
            while (matches.find()) {
                val intent = links.intent(context, matches.group()) ?: continue
                addLink(
                    LinkAnnotation.Clickable(
                        tag = "help",
                        styles = TextLinkStyles(style = SpanStyle(color = color, textDecoration = TextDecoration.Underline)),
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
