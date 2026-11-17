// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.util.Log
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.lang.ref.WeakReference
import java.util.Date
import kotlinx.coroutines.delay
import org.plainphone.app.R
import org.plainphone.app.light.CalmScreen
import org.plainphone.app.sync.CheckInRequest
import org.plainphone.app.ui.PlainphoneTheme

/** Shows over the lock screen and wakes the display, like an alarm clock. */
private fun Activity.showOverLockScreen() {
    if (Build.VERSION.SDK_INT >= 27) {
        setShowWhenLocked(true)
        setTurnScreenOn(true)
    } else {
        @Suppress("DEPRECATION")
        window.addFlags(WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON)
    }
    window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
}

/** "m:ss" */
internal fun countdown(ms: Long): String {
    val s = ((ms + 999) / 1000).coerceAtLeast(0)
    return "%d:%02d".format(s / 60, s % 60)
}

@Composable
private fun rememberNow(): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(1_000)
            now = System.currentTimeMillis()
        }
    }
    return now
}

/** "Your parent is looking for you" with one big "I'm here". */
class RingActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        showOverLockScreen()
        enableEdgeToEdge()
        setContent {
            PlainphoneTheme {
                val ui by RingService.state.collectAsState()
                val now = rememberNow()
                val r = ui
                if (r == null) {
                    LaunchedEffect(Unit) { finish() }
                } else {
                    RingScreen(r, now, onHere = {
                        RingService.answer(this)
                        if (r.stopOnAnswer) finish()
                    })
                }
            }
        }
    }
}

@Composable
fun RingScreen(ui: RingUi, nowMs: Long, onHere: () -> Unit) {
    val left = countdown(ui.endsAtMs - nowMs)
    if (!ui.answered) {
        CalmScreen(
            eyebrow = stringResource(R.string.ring_eyebrow),
            title = stringResource(R.string.ring_title),
            body = stringResource(R.string.ring_body),
            primary = stringResource(R.string.ring_here),
            onPrimary = onHere,
        ) { Pulse() }
    } else {
        // The parent chose the full 5 minutes: the answer is sent, the sound goes on.
        CalmScreen(
            eyebrow = stringResource(R.string.ring_eyebrow),
            title = stringResource(R.string.ring_thanks),
            body = stringResource(R.string.ring_keeps_going, left),
            primary = null,
            onPrimary = {},
        )
    }
}

@Composable
private fun Pulse() {
    Box(Modifier.size(14.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
}

/** "Are you okay?": "Yes, I'm okay" and, when the parent picked a number, "Call me". */
class CheckInActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        current = WeakReference(this)
        showOverLockScreen()
        enableEdgeToEdge()
        val c = Safety.currentCheckIn(this)
        if (c == null) {
            finish()
            return
        }
        Safety.checkInShown(this, c.id)
        setContent {
            PlainphoneTheme {
                val now = rememberNow()
                if (now >= c.deadline.toEpochMilli()) LaunchedEffect(Unit) { finish() }
                CheckInScreen(
                    c,
                    deadlineText = android.text.format.DateFormat.getTimeFormat(this).format(Date(c.deadline.toEpochMilli())),
                    onOk = {
                        Safety.answerCheckIn(this, c.id, "ok")
                        finish()
                    },
                    onCall = {
                        Safety.answerCheckIn(this, c.id, "call")
                        call(c.callNumber!!)
                        finish()
                    },
                )
            }
        }
    }

    private fun call(number: String) {
        // Plainphone is the phone app; the number is an approved contact (the server checks it).
        runCatching { startActivity(Intent(Intent.ACTION_CALL, Uri.fromParts("tel", number, null))) }
            .onFailure { Log.w("Plainphone", "call back failed: ${it.message}") }
    }

    override fun onDestroy() {
        if (current?.get() === this) current = null
        super.onDestroy()
    }

    companion object {
        private var current: WeakReference<CheckInActivity>? = null

        fun closeAll() {
            current?.get()?.let { a -> a.runOnUiThread { a.finish() } }
        }
    }
}

@Composable
fun CheckInScreen(c: CheckInRequest, deadlineText: String, onOk: () -> Unit, onCall: () -> Unit) {
    CalmScreen(
        eyebrow = stringResource(R.string.checkin_eyebrow),
        title = stringResource(R.string.checkin_title),
        body = stringResource(if (c.sendLocation) R.string.checkin_body_location else R.string.checkin_body, deadlineText),
        primary = stringResource(R.string.checkin_ok),
        onPrimary = onOk,
        secondary = if (c.callNumber != null) stringResource(R.string.checkin_call) else null,
        onSecondary = onCall,
    )
}
