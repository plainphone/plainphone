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
import android.telecom.TelecomManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.EmergencyNumbers
import org.plainphone.app.contacts.HelpReplies
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.inbox.FamilyInbox
import org.plainphone.app.inbox.FamilyThreadScreen
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.telephony.CallNotifications
import org.plainphone.app.telephony.SmsStore
import org.plainphone.app.telephony.SmsThread
import org.plainphone.app.telephony.SmsThreadKind
import org.plainphone.app.telephony.ThreadCursor
import org.plainphone.app.telephony.ThreadPage

/** The three tabs, and the keypad, which opens over them. */
enum class Tab { CONTACTS, RECENTS, MESSAGES, KEYPAD }

/** What an incoming intent asks the screen to show. */
data class Route(
    val tab: Tab,
    val number: String? = null,
    val body: String? = null,
    val nonce: Long = System.nanoTime(),
    val threadKind: SmsThreadKind? = null,
    /** Open the family inbox (from its notification). */
    val family: Boolean = false,
    /** Open the conversation with this extended family contact (from its notification). */
    val contact: String? = null,
)

/**
 * The phone and messages app: people (with the parents, 112 and help lines first), recent calls,
 * messages with the family inbox, and a keypad. Also the default handler for DIAL and SENDTO
 * (sms/smsto/mms/mmsto), which the phone and SMS roles require.
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
            intent?.getBooleanExtra(EXTRA_FAMILY, false) == true -> Route(Tab.MESSAGES, family = true)
            intent?.getStringExtra(EXTRA_EXTENDED) != null -> Route(Tab.MESSAGES, contact = intent.getStringExtra(EXTRA_EXTENDED))
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
        private const val EXTRA_FAMILY = "org.plainphone.app.FAMILY_INBOX"
        private const val EXTRA_EXTENDED = "org.plainphone.app.EXTENDED_CONTACT"
        private const val MESSAGES_ALIAS = ".MessagesLauncher"

        fun favouritesIntent(context: Context): Intent = Intent(context, PhoneActivity::class.java)

        fun conversationIntent(context: Context, thread: SmsThread): Intent =
            Intent(context, PhoneActivity::class.java)
                .putExtra(EXTRA_CONVERSATION, thread.number)
                .putExtra(EXTRA_THREAD_KIND, thread.kind.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

        fun extendedIntent(context: Context, contactId: String): Intent =
            Intent(context, PhoneActivity::class.java)
                .putExtra(EXTRA_EXTENDED, contactId)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)

        fun familyIntent(context: Context): Intent =
            Intent(context, PhoneActivity::class.java)
                .putExtra(EXTRA_FAMILY, true)
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
        // The approved number is dialled, not the typed one: the rule matched the normalised form (12345678 for +4512345678).
        val dial = rules?.contactFor(number)?.number?.takeIf { it.isNotBlank() } ?: number
        context.getSystemService(TelecomManager::class.java).placeCall(Uri.fromParts("tel", dial, null), Bundle())
        rules?.replyHelpContact(number, Channel.CALL)?.let { HelpReplies(context).record(Channel.CALL, it.number) }
        null
    }.getOrElse { context.getString(R.string.call_failed) }
}

/** The parents from the rules' SOS block (contacts marked for SOS): first on the People tab. */
private fun sosParents(context: Context): List<ApprovedContact> {
    val rules = SyncStore(context).rules() ?: return emptyList()
    return if (rules.profile == "child" && !rules.release) rules.sos?.parents.orEmpty() else emptyList()
}

@Composable
internal fun PhoneApp(route: Route, resumed: Int) {
    val context = LocalContext.current
    var tab by remember(route) { mutableStateOf(route.tab) }
    // The tab the keypad goes back to; null when the keypad was opened from outside (DIAL).
    var keypadFrom by remember(route) { mutableStateOf(if (route.tab == Tab.KEYPAD) null else Tab.CONTACTS) }
    var familyOpen by remember(route) { mutableStateOf(route.family) }
    var contactOpen by remember(route) { mutableStateOf(route.contact) }
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
    val parents by produceState(emptyList<ApprovedContact>(), resumed, refreshRules) {
        value = withContext(Dispatchers.IO) { sosParents(context) }
    }
    val parentKeys = remember(parents, rules.country) { parents.map { PhoneNumbers.normalize(it.number, rules.country) ?: it.number }.toSet() }
    val inboxChanges by FamilyInbox.changes.collectAsState()
    val family by produceState<FamilyPreview?>(null, resumed, inboxChanges) {
        value = withContext(Dispatchers.IO) { familyPreview(context) }
    }
    val missed by produceState<MissedCall?>(null, resumed, tab) {
        value = withContext(Dispatchers.IO) { unseenMissedCall(context) }
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

    if (familyOpen && family != null) {
        BackHandler { familyOpen = false }
        FamilyThreadScreen(onBack = { familyOpen = false })
        return
    }
    contactOpen?.let { id ->
        BackHandler { contactOpen = null }
        org.plainphone.app.extended.ExtendedConversationScreen(id, onBack = { contactOpen = null })
        return
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
    if (tab == Tab.KEYPAD) {
        val back = keypadFrom
        if (back != null) BackHandler { tab = back }
        KeypadScreen(
            initial = route.number.takeIf { route.tab == Tab.KEYPAD }.orEmpty(),
            onCall = call,
            onParents = { tab = Tab.CONTACTS },
            showParents = !rules.selfProfile,
            onEmergency = { org.plainphone.app.sos.openEmergencyDialer(context) },
            onBack = back?.let { b -> { tab = b } },
        )
        return
    }

    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            Row(
                Modifier.fillMaxWidth().statusBarsPadding().padding(start = 20.dp, end = 8.dp, top = 12.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                ScreenTitle(stringResource(tab.title()), Modifier.weight(1f))
                if (tab == Tab.MESSAGES) NewMessageAction(rules) { conversationWith = it }
                else TextButton(onClick = { keypadFrom = tab; tab = Tab.KEYPAD }, modifier = Modifier.heightIn(min = 48.dp)) {
                    Icon(PlainIcons.Keypad, contentDescription = null, modifier = Modifier.size(20.dp))
                    Text(stringResource(R.string.tab_keypad), Modifier.padding(start = 8.dp), fontWeight = FontWeight.Bold)
                }
            }
        },
        snackbarHost = { SnackbarHost(snackbar) },
        bottomBar = { PhoneTabs(tab) { tab = it } },
    ) { padding ->
        Column(Modifier.padding(padding).fillMaxSize()) {
            RoleBanner(resumed)
            when (tab) {
                Tab.CONTACTS -> ContactsScreen(
                    rules, resumed, onRulesChanged = { refreshRules++ },
                    onCall = call, onMessage = { conversationWith = SmsThread(it.number) },
                    parents = parents,
                    onHelp = { context.startActivity(Intent(context, org.plainphone.app.contacts.HelpActivity::class.java)) },
                    onEmergency = { org.plainphone.app.sos.openEmergencyDialer(context) },
                    missed = missed,
                )
                Tab.RECENTS -> RecentsScreen(rules, resumed, onCall = call)
                Tab.MESSAGES -> ConversationsScreen(
                    rules, threadPage?.threads, threadListState,
                    hasMore = threadPage?.next != null,
                    failed = historyFailed,
                    loading = historyLoading,
                    onMore = {
                        if (!historyFailed) threadAfter = threadPage?.next
                        threadRequest++
                    },
                    onOpen = { conversationWith = it },
                    parents = parentKeys,
                    header = { MessagesHeader(family, onOpenContact = { contactOpen = it }) { familyOpen = true } },
                )
                Tab.KEYPAD -> Unit
            }
        }
    }
}

/** The three tabs. Labels stay on one line up to 150 % text; the screen reader reads them in full. */
@Composable
private fun PhoneTabs(tab: Tab, onTab: (Tab) -> Unit) {
    val t = plainTokens
    val scale = LocalDensity.current.fontScale
    NavigationBar(containerColor = t.sheet, tonalElevation = 0.dp) {
        listOf(Tab.CONTACTS, Tab.RECENTS, Tab.MESSAGES).forEach { item ->
            NavigationBarItem(
                selected = item == tab,
                onClick = { onTab(item) },
                icon = { Icon(item.icon(), contentDescription = null) },
                label = {
                    Text(
                        stringResource(item.title()),
                        fontSize = (12f * minOf(scale, 1.5f) / scale).sp,
                        fontWeight = if (item == tab) FontWeight.Bold else FontWeight.Normal,
                        maxLines = 1,
                    )
                },
                colors = NavigationBarItemDefaults.colors(
                    selectedIconColor = t.ink,
                    selectedTextColor = t.ink,
                    indicatorColor = t.tint,
                    unselectedIconColor = t.pencil,
                    unselectedTextColor = t.pencil,
                ),
            )
        }
    }
}

/** What the Messages tab shows of the family inbox: the newest line, or null while it is off. */
internal data class FamilyPreview(val last: String?, val atMs: Long?)

private fun familyPreview(context: Context): FamilyPreview? {
    if (!FamilyInbox.rules(context).enabled) return null
    val last = FamilyInbox.entries(context).lastOrNull()
    return FamilyPreview(last?.text, last?.atMs)
}

/**
 * Above the conversations: the family inbox when it is on; otherwise the quick messages (#109), as
 * before, when the parents set some up.
 */
@Composable
internal fun MessagesHeader(family: FamilyPreview?, onOpenContact: (String) -> Unit = {}, onOpenFamily: () -> Unit) {
    val context = LocalContext.current
    if (family != null) {
        Sheet(Modifier.padding(bottom = 12.dp)) {
            PersonRow(
                stringResource(R.string.inbox_title),
                emphasis = true,
                titleWeight = FontWeight.Bold,
                onClick = onOpenFamily,
                aside = family.atMs?.let { at -> { Text(shortWhen(context, at), style = MonoSmall, color = MaterialTheme.colorScheme.onSurfaceVariant) } },
                lines = { Secondary(family.last ?: stringResource(R.string.inbox_row_hint)) },
            )
        }
        // The people the parents invited, below the family conversation (docs/extended-family.md).
        org.plainphone.app.extended.FamilyContactsSection(onOpenContact)
        return
    }
    // With the inbox off, extended family is paused: the people on the roster still show, so the child can block.
    org.plainphone.app.extended.FamilyContactsSection(onOpenContact)
    if (org.plainphone.app.sos.childQuickMessages(context, withSuggest = false) == null) return
    Sheet(Modifier.padding(bottom = 12.dp)) {
        org.plainphone.app.sos.ChildQuickMessages(withSuggest = false, modifier = Modifier.padding(16.dp))
    }
}

@Composable
internal fun NewMessageAction(rules: ContactRules, onOpen: (SmsThread) -> Unit) {
    if ((!rules.selfProfile && !rules.childProfile) || rules.enforced) return
    var open by remember { mutableStateOf(false) }
    val title = stringResource(R.string.message_new)
    TextButton(onClick = { open = true }, modifier = Modifier.heightIn(min = 48.dp)) {
        Icon(PlainIcons.Plus, contentDescription = null, modifier = Modifier.size(20.dp))
        Text(title, Modifier.padding(start = 8.dp), fontWeight = FontWeight.Bold)
    }
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
    Tab.CONTACTS -> PlainIcons.Person
    Tab.RECENTS -> PlainIcons.Clock
    Tab.MESSAGES -> PlainIcons.Message
    Tab.KEYPAD -> PlainIcons.Keypad
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
    Notice(stringResource(R.string.role_banner_text), Modifier.padding(vertical = 8.dp))
    Button(
        onClick = { launcher.launch(roles.createRequestRoleIntent(missing.first())) },
        modifier = Modifier.padding(horizontal = 16.dp).heightIn(min = 48.dp),
        colors = ButtonDefaults.buttonColors(containerColor = AnswerFill, contentColor = OnAnswer),
    ) {
        Text(stringResource(if (missing.first() == RoleManager.ROLE_DIALER) R.string.role_make_phone else R.string.role_make_sms))
    }
}

/** 3x4 phone keypad, shared by the keypad screen and the in-call screen (DTMF). */
@Composable
fun Keypad(onKey: (Char) -> Unit, modifier: Modifier = Modifier) {
    val t = plainTokens
    val rows = listOf("123", "456", "789", "*0#")
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEach { key ->
                    Surface(
                        onClick = { onKey(key) },
                        shape = CircleShape,
                        color = t.sheet,
                        contentColor = t.ink,
                        border = BorderStroke(1.dp, t.divider),
                        modifier = Modifier.weight(1f).aspectRatio(1.5f).heightIn(min = 48.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) { Text(key.toString(), fontSize = 26.sp, fontFamily = PlainMono) }
                    }
                }
            }
        }
    }
}
