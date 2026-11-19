// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.content.Intent
import android.os.Bundle
import android.telecom.Call
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Call
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import org.plainphone.app.R
import org.plainphone.app.telephony.CallManager
import org.plainphone.app.telephony.CallNotifications
import org.plainphone.app.telephony.CallUi

/** The call screen. Shows over the lock screen and turns the screen on for incoming calls. */
class InCallActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        enableEdgeToEdge()
        handle(intent)
        setContent {
            PlainphoneTheme {
                val calls by CallManager.state.collectAsState()
                val audio by CallManager.audio.collectAsState()
                val primary = calls.firstOrNull { it.state == Call.STATE_RINGING }
                    ?: calls.firstOrNull { it.state == Call.STATE_ACTIVE }
                    ?: calls.firstOrNull()
                LaunchedEffect(calls.isEmpty()) {
                    if (calls.isEmpty()) {
                        delay(800) // Let "Call ended" show for a moment.
                        finish()
                    }
                }
                InCallScreen(primary, audio)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handle(intent)
    }

    private fun handle(intent: Intent?) {
        if (intent?.action == CallNotifications.ACTION_ANSWER) CallManager.answer()
    }
}

@Composable
private fun InCallScreen(call: CallUi?, audio: CallManager.Audio) {
    var showKeypad by remember { mutableStateOf(false) }
    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        Column(
            Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(48.dp))
            val title = call?.name ?: call?.number ?: stringResource(R.string.call_unknown)
            Initial(title, 96.dp)
            Spacer(Modifier.height(20.dp))
            Text(title, fontSize = 30.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
            if (call?.name != null && call.number != null) {
                Text(call.number, style = MaterialTheme.typography.bodyLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Spacer(Modifier.height(8.dp))
            CallStatus(call)
            Spacer(Modifier.weight(1f))

            when {
                call == null -> Unit
                call.state == Call.STATE_RINGING -> Row(
                    Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly,
                ) {
                    RoundAction(stringResource(R.string.call_decline), EndCallRed, rotate = true) { CallManager.decline() }
                    RoundAction(stringResource(R.string.call_answer), AnswerGreen) { CallManager.answer() }
                }
                else -> {
                    if (showKeypad) {
                        Keypad(onKey = { CallManager.playDtmf(it) }, modifier = Modifier.widthIn(max = 300.dp))
                        Spacer(Modifier.height(16.dp))
                    }
                    val muted = audio.muted
                    val speaker = audio.onSpeaker
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                        Toggle(stringResource(R.string.call_mute), muted) { CallManager.setMuted(!muted) }
                        Toggle(stringResource(R.string.call_keypad), showKeypad) { showKeypad = !showKeypad }
                        Toggle(stringResource(R.string.call_speaker), speaker) { CallManager.setSpeaker(!speaker) }
                    }
                    Spacer(Modifier.height(28.dp))
                    if (org.plainphone.app.sos.SosCalls.callId == call.id) {
                        androidx.compose.material3.Button(onClick = org.plainphone.app.sos.SosCalls::stop) {
                            Text(stringResource(R.string.sos_stop_call))
                        }
                    } else {
                        RoundAction(stringResource(R.string.call_hang_up), EndCallRed, rotate = true) { CallManager.hangUp() }
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun CallStatus(call: CallUi?) {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(call?.state) {
        while (call?.state == Call.STATE_ACTIVE) {
            now = System.currentTimeMillis()
            delay(1000)
        }
    }
    val text = when (call?.state) {
        null, Call.STATE_DISCONNECTED -> stringResource(R.string.call_ended)
        Call.STATE_RINGING -> stringResource(R.string.call_incoming)
        Call.STATE_DIALING, Call.STATE_CONNECTING, Call.STATE_NEW, Call.STATE_PULLING_CALL -> stringResource(R.string.call_dialing)
        Call.STATE_HOLDING -> stringResource(R.string.call_on_hold)
        Call.STATE_ACTIVE -> call.connectedAtMs?.let { formatDuration(now - it) } ?: ""
        else -> ""
    }
    Text(text, style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
}

internal fun formatDuration(ms: Long): String {
    val total = (ms.coerceAtLeast(0) / 1000)
    val h = total / 3600
    val m = (total % 3600) / 60
    val s = total % 60
    return if (h > 0) "%d:%02d:%02d".format(h, m, s) else "%d:%02d".format(m, s)
}

@Composable
private fun RoundAction(label: String, color: Color, rotate: Boolean = false, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        FilledIconButton(
            onClick = onClick,
            modifier = Modifier.size(76.dp),
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = color, contentColor = Color.White),
        ) {
            Icon(
                Icons.Filled.Call,
                contentDescription = label,
                modifier = Modifier.size(34.dp).graphicsLayer { rotationZ = if (rotate) 135f else 0f },
            )
        }
        Spacer(Modifier.height(8.dp))
        Text(label, style = MaterialTheme.typography.labelLarge)
    }
}

@Composable
private fun Toggle(label: String, on: Boolean, onClick: () -> Unit) {
    FilledTonalButton(
        onClick = onClick,
        colors = if (on) {
            androidx.compose.material3.ButtonDefaults.filledTonalButtonColors(
                containerColor = MaterialTheme.colorScheme.primary,
                contentColor = MaterialTheme.colorScheme.onPrimary,
            )
        } else {
            androidx.compose.material3.ButtonDefaults.filledTonalButtonColors()
        },
    ) { Text(label) }
}
