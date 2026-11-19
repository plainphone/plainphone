// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.os.SystemClock
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.focusable
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.KeyEventType
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onPreviewKeyEvent
import androidx.compose.ui.input.key.type
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.onClick
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.home.HomeActivity
import org.plainphone.app.sync.SyncStore

@Composable
internal fun SosScreen(onBack: () -> Unit, emergency: () -> Unit) {
    val context = LocalContext.current
    val sync = remember { SyncStore(context) }
    val rules = sync.rules()
    val sos = rules?.sos
    val callActive by SosCalls.active.collectAsState()
    var pending by remember { mutableStateOf<SosConfirmation?>(null) }
    var now by remember { mutableLongStateOf(0L) }
    var hint by remember { mutableStateOf<Int?>(null) }
    var id by rememberSaveable {
        mutableStateOf(sync.phoneId?.let { SosDelivery.prefs(context).getString("last:$it", null) })
    }
    val sentAt = id?.let { SosDelivery.prefs(context).getLong("time:$it", 0) }?.takeIf { it > 0 }?.let {
        HomeActivity.timeText(context, java.time.Instant.ofEpochMilli(it).atZone(java.time.ZoneId.systemDefault()).toLocalTime())
    }
    var status by remember { mutableStateOf<String?>(null) }
    var callMissed by remember { mutableStateOf(false) }
    var seenByName by rememberSaveable { mutableStateOf<String?>(null) }
    var seen by rememberSaveable { mutableStateOf(false) }

    LaunchedEffect(pending) {
        val confirmation = pending ?: return@LaunchedEffect
        while (SystemClock.elapsedRealtime() < confirmation.deadline) {
            delay(50)
            now = SystemClock.elapsedRealtime()
        }
        val kind = confirmation.sendIfDue(SystemClock.elapsedRealtime()) ?: return@LaunchedEffect
        val phoneId = sync.phoneId
        if (phoneId != null) {
            id = SosDelivery.enqueue(context, phoneId, kind)
            seen = false
            seenByName = null
        }
        pending = null
    }
    LaunchedEffect(id, rules?.phoneId) {
        val sentId = id ?: return@LaunchedEffect
        while (true) {
            status = SosDelivery.status(context, sentId)
            callMissed = SosDelivery.callMissed(context, sentId)
            if (!seen && (status == "online" || status == "sms")) {
                val confirmation = withContext(Dispatchers.IO) {
                    runCatching {
                        val token = sync.deviceToken() ?: return@runCatching null
                        SosDelivery.api(context).sosStatus(token, sentId)
                    }.getOrNull()
                }
                if (confirmation != null && !confirmation.isNull("seenAt")) {
                    seenByName = confirmation.optString("seenByName").takeUnless { confirmation.isNull("seenByName") }
                    seen = true
                }
            }
            delay(if (status == "online" || status == "sms") 5_000 else 250)
        }
    }

    fun prepare(kind: SosKind) {
        hint = null
        now = SystemClock.elapsedRealtime()
        pending = SosConfirmation(kind, now)
    }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.surface) {
        Column(
            Modifier.safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            OutlinedButton(onClick = onBack) { Text(stringResource(R.string.sos_back)) }
            Text(stringResource(R.string.sos_title), style = MaterialTheme.typography.headlineLarge)
            if (sos != null && rules.profile == "child" && !rules.release) {
                Text(stringResource(R.string.sos_intro))
                if (rules.locationEnabled && rules.locationMode != "off") Text(stringResource(R.string.sos_location))
                if (sos.parents.isEmpty()) Text(stringResource(R.string.sos_no_parents))
                val confirmation = pending
                if (confirmation != null) {
                    val seconds = ((confirmation.deadline - now).coerceAtLeast(0) + 999) / 1000
                    Text(stringResource(R.string.sos_sending_in, seconds))
                    Button(onClick = { confirmation.cancel(); pending = null }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.sos_undo))
                    }
                } else {
                    HoldAction(stringResource(R.string.sos_urgent), { hint = R.string.sos_hold }, { prepare(SosKind.URGENT) })
                    HoldAction(stringResource(R.string.sos_help), { hint = R.string.sos_hold }, { prepare(SosKind.HELP) })
                }
            }
            HoldAction(stringResource(R.string.sos_emergency), { hint = R.string.sos_hold_emergency }) {
                pending?.cancel()
                pending = null
                SosCalls.stop()
                emergency()
            }
            hint?.let { Text(stringResource(it), Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            val message = when {
                seen -> seenByName?.let { stringResource(R.string.sos_seen_by, it) } ?: stringResource(R.string.sos_seen)
                status == "online" || status == "sms" -> {
                    val names = id?.let { SosDelivery.smsNames(context, it) }.orEmpty()
                    if (names.isNotEmpty()) stringResource(R.string.sos_sent_to, android.icu.text.ListFormatter.getInstance().format(names), sentAt.orEmpty())
                    else if (status == "online") stringResource(R.string.sos_report_received, sentAt.orEmpty())
                    else stringResource(R.string.sos_sent, sentAt.orEmpty())
                }
                status == "failed" -> stringResource(R.string.sos_failed)
                id != null -> stringResource(R.string.sos_pending)
                else -> null
            }
            message?.let { Text(it, Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
            if (callMissed) Text(stringResource(R.string.sos_call_missed), Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            if (callActive) Button(onClick = SosCalls::stop, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.sos_stop_call))
            }
        }
    }
}

@Composable
internal fun HoldAction(label: String, onTap: () -> Unit, onHeld: () -> Unit) {
    val tap by rememberUpdatedState(onTap)
    val held by rememberUpdatedState(onHeld)
    var start by remember { mutableLongStateOf(0L) }
    var elapsed by remember { mutableLongStateOf(0L) }
    var keyboardHeld by remember { mutableStateOf(false) }
    var accessibleConfirmation by remember { mutableStateOf(false) }
    var accessibleRunning by remember { mutableStateOf(false) }
    var accessibleSeconds by remember { mutableLongStateOf(3L) }

    LaunchedEffect(accessibleRunning) {
        if (!accessibleRunning) return@LaunchedEffect
        val started = withFrameNanos { it }
        while (accessibleSeconds > 0 && accessibleRunning) {
            val remaining = SOS_HOLD_MS - withFrameNanos { (it - started) / 1_000_000 }
            accessibleSeconds = (remaining.coerceAtLeast(0) + 999) / 1_000
        }
        if (!accessibleRunning) return@LaunchedEffect
        accessibleRunning = false
        accessibleConfirmation = false
        held()
    }
    if (accessibleConfirmation) {
        fun dismiss() {
            accessibleRunning = false
            accessibleConfirmation = false
        }
        AlertDialog(
            onDismissRequest = ::dismiss,
            title = { Text(label) },
            text = {
                if (accessibleRunning) Text(
                    stringResource(R.string.sos_starting_in, accessibleSeconds),
                    Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                )
            },
            confirmButton = {
                if (!accessibleRunning) TextButton(onClick = {
                    accessibleSeconds = 3
                    accessibleRunning = true
                }) { Text(stringResource(R.string.sos_confirm)) }
            },
            dismissButton = {
                TextButton(onClick = ::dismiss) { Text(stringResource(R.string.sos_undo)) }
            },
        )
    }
    LaunchedEffect(start) {
        while (start != 0L) {
            elapsed = (SystemClock.elapsedRealtime() - start).coerceAtMost(SOS_HOLD_MS)
            delay(24)
        }
    }
    LaunchedEffect(keyboardHeld) {
        if (keyboardHeld) {
            delay(SOS_HOLD_MS)
            start = 0
            held()
        }
    }
    Surface(
        shape = MaterialTheme.shapes.large,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        modifier = Modifier.fillMaxWidth().onFocusChanged {
            if (!it.isFocused && keyboardHeld) {
                keyboardHeld = false
                start = 0
            }
        }.onPreviewKeyEvent { event ->
            if (event.key !in setOf(Key.Enter, Key.Spacebar, Key.DirectionCenter)) return@onPreviewKeyEvent false
            if (event.type == KeyEventType.KeyDown && !keyboardHeld) {
                keyboardHeld = true
                start = SystemClock.elapsedRealtime()
                elapsed = 0
            } else if (event.type == KeyEventType.KeyUp) {
                if (keyboardHeld && start != 0L) tap()
                keyboardHeld = false
                start = 0
            }
            true
        }.semantics(mergeDescendants = true) {
            role = Role.Button
            onClick { accessibleConfirmation = true; true }
        }.focusable().pointerInput(Unit) {
            awaitEachGesture {
                val down = awaitFirstDown(requireUnconsumed = false)
                down.consume()
                start = SystemClock.elapsedRealtime()
                elapsed = 0
                var completed = false
                try {
                    completed = withTimeoutOrNull(SOS_HOLD_MS) {
                        waitForUpOrCancellation()?.consume()
                        false
                    } ?: true
                } finally {
                    start = 0
                }
                if (completed) held() else tap()
            }
        },
    ) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(horizontal = 16.dp, vertical = 12.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (start != 0L) CircularProgressIndicator(
                progress = { elapsed.toFloat() / SOS_HOLD_MS },
                modifier = Modifier.size(24.dp),
            )
            Text(label, style = MaterialTheme.typography.titleMedium)
        }
    }
}
