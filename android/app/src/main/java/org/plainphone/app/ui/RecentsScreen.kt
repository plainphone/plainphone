// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.Manifest
import android.content.ContentValues
import android.content.Context
import android.content.pm.PackageManager
import android.provider.CallLog
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.contactPolicy

internal data class RecentCall(val number: String, val type: Int, val atMs: Long)

/** A missed call nobody has looked at yet (the call log's "new" flag), from the last day. */
data class MissedCall(val number: String, val atMs: Long)

/**
 * The Calls tab: who called and when. A missed call says "Missed" in words and in red, with a
 * call-back button; opening the tab marks missed calls as seen, like any phone app.
 */
@Composable
internal fun RecentsScreen(rules: ContactRules, resumed: Int, onCall: (String) -> Unit) {
    val context = LocalContext.current
    val calls by produceState<List<RecentCall>?>(null, resumed) {
        value = withContext(Dispatchers.IO) { readRecentCalls(context) }
    }
    LaunchedEffect(resumed) { withContext(Dispatchers.IO) { markMissedSeen(context) } }
    var visible by remember(resumed) { mutableIntStateOf(HISTORY_PAGE_SIZE) }
    val list = calls
    if (list == null) {
        EmptyState(stringResource(R.string.history_loading))
        return
    }
    if (list.isEmpty()) {
        EmptyState(stringResource(R.string.recents_empty), stringResource(R.string.recents_empty_hint))
        return
    }
    LazyColumn(contentPadding = PaddingValues(top = 8.dp, bottom = 24.dp)) {
        item {
            Sheet {
                list.take(visible).forEachIndexed { index, r ->
                    if (index > 0) RowDivider()
                    RecentRow(r, rules, onCall)
                }
            }
        }
        if (visible < list.size) item { MoreHistory { visible += HISTORY_PAGE_SIZE } }
    }
}

@Composable
private fun RecentRow(r: RecentCall, rules: ContactRules, onCall: (String) -> Unit) {
    val context = LocalContext.current
    val canCall = r.number.isNotBlank() && context.contactPolicy().decide(rules, Channel.CALL, Direction.OUTGOING, r.number).allowed
    val contact = rules.contactFor(r.number)
    val name = contact?.name ?: r.number.ifBlank { stringResource(R.string.history_unknown) }
    val missed = r.type == CallLog.Calls.MISSED_TYPE || r.type == CallLog.Calls.REJECTED_TYPE
    val kind = when (r.type) {
        CallLog.Calls.INCOMING_TYPE -> R.string.recent_incoming
        CallLog.Calls.OUTGOING_TYPE -> R.string.recent_outgoing
        CallLog.Calls.MISSED_TYPE -> R.string.recent_missed
        CallLog.Calls.REJECTED_TYPE -> R.string.recent_declined
        CallLog.Calls.BLOCKED_TYPE -> R.string.recent_blocked
        else -> R.string.recent_other
    }
    val danger = MaterialTheme.colorScheme.error
    PersonRow(
        name,
        titleColor = if (missed) danger else MaterialTheme.colorScheme.onSurface,
        titleWeight = if (missed) FontWeight.Bold else FontWeight.Normal,
        onClick = if (canCall) ({ onCall(r.number) }) else null,
        lines = {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    if (r.type == CallLog.Calls.OUTGOING_TYPE) PlainIcons.Outgoing else PlainIcons.Incoming,
                    contentDescription = null,
                    tint = if (missed) danger else MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.size(16.dp),
                )
                Text(
                    stringResource(kind) + " · " + shortWhen(context, r.atMs),
                    Modifier.padding(start = 6.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = if (missed) danger else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            if (!canCall && contact == null && r.number.isNotBlank()) Secondary(stringResource(R.string.recent_not_approved))
        },
    ) {
        if (canCall) CallButton(stringResource(if (missed) R.string.action_call_back else R.string.action_call, name)) { onCall(r.number) }
    }
}

internal fun readRecentCalls(context: Context): List<RecentCall> {
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

/** The newest missed call from the last day that nobody has seen yet, or null. */
internal fun unseenMissedCall(context: Context, nowMs: Long = System.currentTimeMillis()): MissedCall? {
    if (context.checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return null
    return runCatching {
        context.contentResolver.query(
            CallLog.Calls.CONTENT_URI,
            arrayOf(CallLog.Calls.NUMBER, CallLog.Calls.DATE),
            "${CallLog.Calls.TYPE} = ${CallLog.Calls.MISSED_TYPE} AND ${CallLog.Calls.NEW} = 1 AND ${CallLog.Calls.DATE} > ?",
            arrayOf((nowMs - 86_400_000L).toString()), "${CallLog.Calls.DATE} DESC",
        )?.use { c -> if (c.moveToFirst()) MissedCall(c.getString(0).orEmpty(), c.getLong(1)) else null }
    }.getOrNull()?.takeIf { it.number.isNotBlank() }
}

/** Opening the Calls tab is looking at them. Needs WRITE_CALL_LOG (the dialer role has it). */
private fun markMissedSeen(context: Context) {
    if (context.checkSelfPermission(Manifest.permission.WRITE_CALL_LOG) != PackageManager.PERMISSION_GRANTED) return
    runCatching {
        context.contentResolver.update(
            CallLog.Calls.CONTENT_URI,
            ContentValues().apply { put(CallLog.Calls.NEW, 0) },
            "${CallLog.Calls.TYPE} = ${CallLog.Calls.MISSED_TYPE} AND ${CallLog.Calls.NEW} = 1",
            null,
        )
    }
}

internal const val HISTORY_PAGE_SIZE = 50

@Composable
internal fun MoreHistory(retry: Boolean = false, onClick: () -> Unit) {
    if (retry) Footnote(stringResource(R.string.history_load_failed))
    TextButton(onClick = onClick, modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        Text(stringResource(if (retry) R.string.history_retry else R.string.history_load_older))
    }
}
