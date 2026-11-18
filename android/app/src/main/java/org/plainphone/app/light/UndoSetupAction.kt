// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.lifecycle.lifecycleScope
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

@Composable
internal fun UndoSetupAction(activity: ComponentActivity, revision: Int) {
    var deadline by remember(revision) { mutableLongStateOf(LightSetup.localUndoDeadline(activity)) }
    var tap by remember(revision) { mutableStateOf(LightSetup.undoTap(activity)) }
    var sending by remember { mutableStateOf(false) }
    var accepted by remember { mutableStateOf(false) }
    var closed by remember(revision) { mutableStateOf(false) }
    LaunchedEffect(revision) {
        while (true) {
            try {
                deadline = withContext(Dispatchers.IO) { LightSetup.undoDeadline(activity) }
                break
            } catch (e: IOException) {
                if (e is HttpError && e.status in 400..499 && e.status != 429) {
                    deadline = 0
                    break
                }
                delay(5_000)
            }
        }
    }
    LaunchedEffect(deadline) {
        if (deadline > 0) {
            delay((deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
            deadline = 0
        }
    }
    LaunchedEffect(tap) {
        tap?.let {
            delay((it.elapsed + SETUP_UNDO_RETRY_MS - SystemClock.elapsedRealtime()).coerceAtLeast(0))
            tap = null
            closed = deadline == 0L
        }
    }

    val store = SyncStore(activity)
    val status = when {
        accepted || (store.setupUndoAuthorized && !store.removed) -> R.string.setup_undo_requested
        sending -> R.string.setup_undo_sending
        closed -> R.string.setup_undo_closed
        tap != null -> R.string.setup_undo_retry
        else -> null
    }
    if (status != null) {
        Text(stringResource(status), Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
    if (!sending && !closed && !store.setupUndoPending && (deadline > 0 || tap != null)) {
        TextButton(onClick = {
            val tappedAt = LightSetup.recordUndoTap(activity, deadline)
            if (tappedAt == null) {
                closed = true
            } else {
                tap = tappedAt
                sending = true
                activity.lifecycleScope.launch {
                    try {
                        accepted = withContext(Dispatchers.IO) {
                            LightSetup.requestUndo(activity, tappedAt).also {
                                LightSetup.clearUndoTap(activity)
                                if (it) SyncScheduler.finishSetupUndo(activity)
                            }
                        }
                        tap = null
                        deadline = 0
                        closed = !accepted
                    } catch (_: IOException) {
                        tap = LightSetup.undoTap(activity)
                        closed = tap == null && deadline == 0L
                    } finally {
                        sending = false
                    }
                }
            }
        }) { Text(stringResource(if (tap == null) R.string.setup_undo else R.string.pairing_retry)) }
    }
}
