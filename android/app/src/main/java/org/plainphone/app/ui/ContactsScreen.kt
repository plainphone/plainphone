// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
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
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.ConfigStore
import org.plainphone.app.R
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.DeviceContacts
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.contacts.contactPolicy
import org.plainphone.app.sos.HoldAction
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.Sync
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

/**
 * The People tab. On a child's phone, the parents, 112 and the help lines come first, on their own
 * sheet, so they are one tap away whatever else is on the list (design principle 3). Then the other
 * approved contacts. A Myself phone sees its own contacts and can choose favourites.
 */
@Composable
internal fun ContactsScreen(
    rules: ContactRules, resumed: Int, onRulesChanged: () -> Unit,
    onCall: (String) -> Unit, onMessage: (ApprovedContact) -> Unit,
    parents: List<ApprovedContact> = emptyList(),
    onHelp: () -> Unit = {},
    onEmergency: () -> Unit = {},
    missed: MissedCall? = null,
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
    var choosing by remember(rules.selfProfile) { mutableStateOf(setupPhoneId != null) }
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
    val parentKeys = remember(parents, rules.country) { parents.mapNotNull { PhoneNumbers.normalize(it.number, rules.country) }.toSet() }
    val isParent: (ApprovedContact) -> Boolean = { (PhoneNumbers.normalize(it.number, rules.country) ?: it.number) in parentKeys }
    val list = remember(rules.contacts, deviceContacts, rules.selfProfile, parentKeys) {
        if (rules.selfProfile) (deviceContacts + rules.contacts).distinctBy { it.number }
        else rules.contacts.filterNot(isParent)
    }
    val reachableParents = remember(rules.contacts, parentKeys) { rules.contacts.filter(isParent) }
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var notice by remember { mutableStateOf<Int?>(null) }
    var emergencyHint by remember { mutableStateOf(false) }

    LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
        missed?.let { m ->
            item {
                val name = rules.contactFor(m.number)?.name ?: m.number
                val canCall = context.contactPolicy().decide(rules, Channel.CALL, Direction.OUTGOING, m.number).allowed
                Notice(
                    stringResource(R.string.missed_notice, name, clockTime(context, m.atMs)),
                    Modifier.padding(top = 8.dp),
                    action = if (canCall) stringResource(R.string.missed_call_back) else null,
                    onAction = { onCall(m.number) },
                )
            }
        }

        if (!rules.selfProfile) item {
            SectionLabel(stringResource(R.string.reach_title))
            Sheet {
                reachableParents.forEachIndexed { index, p ->
                    if (index > 0) RowDivider()
                    ContactRow(p, rules, parent = true, onCall = onCall, onMessage = onMessage)
                }
                if (reachableParents.isNotEmpty()) RowDivider(inset = false)
                val emergency = @Composable { m: Modifier ->
                    Box(m) { HoldAction(stringResource(R.string.sos_emergency), { emergencyHint = true }, onEmergency) }
                }
                val help = @Composable { m: Modifier ->
                    OutlinedButton(
                        onClick = onHelp,
                        modifier = m.heightIn(min = 64.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                        shape = MaterialTheme.shapes.large,
                    ) {
                        Icon(PlainIcons.Help, contentDescription = null, modifier = Modifier.size(20.dp))
                        Text(
                            stringResource(R.string.reach_help),
                            Modifier.padding(start = 8.dp),
                            style = MaterialTheme.typography.titleMedium,
                            textAlign = TextAlign.Center,
                        )
                    }
                }
                // Side by side, or one above the other at large text so neither label is cut.
                if (LocalDensity.current.fontScale >= LARGE_TEXT) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        emergency(Modifier.fillMaxWidth())
                        help(Modifier.fillMaxWidth())
                    }
                } else {
                    Row(
                        Modifier.fillMaxWidth().padding(12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        emergency(Modifier.weight(1f))
                        help(Modifier.weight(1f))
                    }
                }
                if (emergencyHint) Text(
                    stringResource(R.string.sos_hold_emergency),
                    Modifier.padding(start = 16.dp, end = 16.dp, bottom = 12.dp).semantics { liveRegion = LiveRegionMode.Polite },
                    style = MaterialTheme.typography.bodyMedium,
                )
            }
            Footnote(stringResource(R.string.reach_footnote))
        }

        if (rules.selfProfile) item {
            Column(Modifier.padding(horizontal = 20.dp, vertical = 8.dp)) {
                if (!canRead) TextButton(onClick = { permission.launch(Manifest.permission.READ_CONTACTS) }) {
                    Text(stringResource(R.string.contacts_read_permission))
                }
                TextButton(onClick = { if (choosing) finishChoosing() else choosing = true }) {
                    Text(stringResource(if (choosing) R.string.contacts_favourites_done else R.string.contacts_favourites_choose))
                }
                if (choosing) Text(stringResource(R.string.contacts_favourites_hint))
                if (choosing && setupPhoneId != null) TextButton(onClick = ::finishChoosing) {
                    Text(stringResource(R.string.contacts_favourites_skip))
                }
                notice?.let { Text(stringResource(it), modifier = Modifier.padding(top = 8.dp)) }
            }
        }

        if (list.isEmpty()) {
            if (rules.selfProfile || reachableParents.isEmpty()) item {
                EmptyState(
                    stringResource(if (rules.selfProfile) R.string.contacts_self_empty else R.string.contacts_empty_title),
                    if (rules.selfProfile) null else stringResource(R.string.contacts_empty),
                )
            }
        } else {
            item { SectionLabel(stringResource(if (rules.selfProfile) R.string.contacts_all else R.string.contacts_approved)) }
            item {
                Sheet {
                    list.forEachIndexed { index, c ->
                        if (index > 0) RowDivider()
                        val favourite = rules.selfProfile && rules.contactFor(c.number) != null
                        if (choosing && rules.selfProfile && DeviceContacts.internationalNumber.matches(c.number)) {
                            val action = stringResource(if (favourite) R.string.contacts_favourite_remove else R.string.contacts_favourite_add)
                            PersonRow(c.name, lines = {
                                Secondary(c.number, style = MonoSmall)
                                if (favourite) Secondary(stringResource(R.string.contacts_favourite))
                            }) {
                                TextButton(
                                    enabled = !busy,
                                    modifier = Modifier.heightIn(min = 48.dp).semantics { contentDescription = "$action ${c.name}" },
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
                                ) { Text(action, fontWeight = FontWeight.Bold) }
                            }
                        } else {
                            ContactRow(c, rules, favourite = favourite, onCall = onCall, onMessage = onMessage)
                        }
                    }
                }
            }
        }
        if (rules.childProfile) item {
            Footnote(stringResource(if (rules.suggestDeviceContacts) R.string.contacts_child_sharing else R.string.contacts_child_sharing_off))
            if (!canRead && rules.suggestDeviceContacts) TextButton(
                onClick = { permission.launch(Manifest.permission.READ_CONTACTS) },
                modifier = Modifier.padding(horizontal = 12.dp),
            ) { Text(stringResource(R.string.contacts_read_permission)) }
        }
        if (!rules.selfProfile && rules.enforced) item { Footnote(stringResource(R.string.contacts_footnote)) }
    }
}

/** One contact: the row calls, the buttons message and call. A contact the rules block says so. */
@Composable
private fun ContactRow(
    c: ApprovedContact, rules: ContactRules, parent: Boolean = false, favourite: Boolean = false,
    onCall: (String) -> Unit, onMessage: (ApprovedContact) -> Unit,
) {
    val context = LocalContext.current
    val canCall = context.contactPolicy().decide(rules, Channel.CALL, Direction.OUTGOING, c.number).allowed
    val canText = context.contactPolicy().decide(rules, Channel.SMS, Direction.OUTGOING, c.number).allowed
    PersonRow(
        c.name,
        emphasis = parent,
        onClick = if (canCall) ({ onCall(c.number) }) else null,
        lines = {
            if (parent) Secondary(stringResource(R.string.contacts_parent))
            Secondary(c.number, style = MonoSmall)
            if (favourite) Secondary(stringResource(R.string.contacts_favourite))
            if (!canCall && !canText) Secondary(stringResource(R.string.contacts_not_now))
        },
    ) {
        if (canText) MessageButton(stringResource(R.string.action_message, c.name)) { onMessage(c) }
        if (canCall) CallButton(stringResource(R.string.action_call, c.name)) { onCall(c.number) }
    }
}
