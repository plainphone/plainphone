// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import java.text.DateFormat
import java.util.Date
import org.plainphone.app.R
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.BlockedEvent
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.telephony.HeldSms

/**
 * Parent screen behind the maintenance PIN: add and remove approved contacts,
 * and see what was blocked. Not exported, so only the PIN-checked maintenance
 * screen can open it.
 */
class ApprovedContactsActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        setContent { PlainphoneTheme { ApprovedContactsScreen(onBack = ::finish) } }
    }

    override fun onStop() {
        super.onStop()
        // Leaving the screen ends the parent session; the PIN is needed again.
        if (!isChangingConfigurations) finish()
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ApprovedContactsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val source = remember { ContactPolicySources.get(context) }
    val log = remember { TelephonyLog(context) }
    var version by remember { mutableIntStateOf(0) }
    val contacts = remember(version) { source.rules().contacts }
    val blocked = remember(version) { log.blocked() }
    val heldStore = remember { HeldSms(context) }
    val held = remember(version) { heldStore.messages() }
    var name by remember { mutableStateOf("") }
    var number by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    val invalidNumber = stringResource(R.string.contacts_admin_invalid)

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(R.string.contacts_admin_title), fontWeight = FontWeight.SemiBold) },
                actions = { TextButton(onClick = onBack) { Text(stringResource(R.string.action_done)) } },
            )
        },
    ) { padding ->
        LazyColumn(
            Modifier.padding(padding).fillMaxSize().imePadding(),
            contentPadding = PaddingValues(20.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            item {
                Text(stringResource(R.string.contacts_admin_intro), style = MaterialTheme.typography.bodyMedium)
            }
            if (source.managedRemotely) item {
                Text(stringResource(R.string.contacts_admin_managed), style = MaterialTheme.typography.bodyMedium)
            } else item {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(
                        value = name, onValueChange = { name = it },
                        label = { Text(stringResource(R.string.contacts_admin_name)) },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                    )
                    OutlinedTextField(
                        value = number, onValueChange = { number = it },
                        label = { Text(stringResource(R.string.contacts_admin_number)) },
                        singleLine = true, modifier = Modifier.fillMaxWidth(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
                        supportingText = { Text(error ?: stringResource(R.string.contacts_admin_number_help)) },
                        isError = error != null,
                    )
                    Button(
                        onClick = {
                            source.add(ApprovedContact(name, number))
                                .onSuccess { name = ""; number = ""; error = null; version++ }
                                .onFailure { error = invalidNumber }
                        },
                        enabled = number.isNotBlank(),
                    ) { Text(stringResource(R.string.contacts_admin_add)) }
                }
            }
            item { SectionTitle(stringResource(R.string.contacts_admin_list, contacts.size)) }
            items(contacts, key = { "c" + it.number }) { c ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Initial(c.name, 40.dp)
                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                        Text(c.name, style = MaterialTheme.typography.titleMedium)
                        Text(c.number, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (!source.managedRemotely) {
                        IconButton(onClick = { source.remove(c.number); version++ }) {
                            Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.contacts_admin_remove, c.name))
                        }
                    }
                }
            }
            if (held.isNotEmpty()) {
                item {
                    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        SectionTitle(stringResource(R.string.held_title, held.size))
                        Text(stringResource(R.string.held_intro), style = MaterialTheme.typography.bodyMedium)
                    }
                }
                items(held, key = { "h" + it.id }) { m ->
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text(m.sender.ifBlank { TelephonyLog.HIDDEN }, style = MaterialTheme.typography.titleMedium)
                            Text(m.body, style = MaterialTheme.typography.bodyMedium)
                            Text(
                                DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(m.atMs)),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        IconButton(onClick = { heldStore.discard(m.id); version++ }) {
                            Icon(Icons.Filled.Delete, contentDescription = stringResource(R.string.held_delete, m.sender))
                        }
                    }
                }
                item { TextButton(onClick = { heldStore.clear(); version++ }) { Text(stringResource(R.string.held_clear)) } }
            }
            item { SectionTitle(stringResource(R.string.blocked_title, blocked.size)) }
            if (blocked.isEmpty()) {
                item { Text(stringResource(R.string.blocked_empty), color = MaterialTheme.colorScheme.onSurfaceVariant) }
            } else {
                items(blocked) { BlockedRow(it) }
                item {
                    TextButton(onClick = { log.clearBlocked(); version++ }) { Text(stringResource(R.string.blocked_clear)) }
                }
            }
        }
    }
}

@Composable
private fun SectionTitle(text: String) {
    Column {
        HorizontalDivider(Modifier.padding(vertical = 12.dp))
        Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold)
    }
}

@Composable
private fun BlockedRow(e: BlockedEvent) {
    val what = stringResource(
        when (e.channel to e.direction) {
            Channel.CALL to Direction.INCOMING -> R.string.blocked_call_in
            Channel.CALL to Direction.OUTGOING -> R.string.blocked_call_out
            Channel.SMS to Direction.INCOMING -> R.string.blocked_sms_in
            else -> R.string.blocked_sms_out
        },
    )
    Column {
        Text("$what: ${e.number}", style = MaterialTheme.typography.bodyMedium)
        Text(
            DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(e.atMs)),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
