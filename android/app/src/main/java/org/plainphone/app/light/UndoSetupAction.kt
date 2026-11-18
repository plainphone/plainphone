// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.res.stringResource
import android.os.SystemClock
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.plainphone.app.sync.HttpError
import org.plainphone.app.R
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

@Composable
internal fun UndoSetupAction(activity: ComponentActivity, revision: Int, onUndo: () -> Unit) {
    var deadline by remember(revision) { mutableLongStateOf(0) }
    LaunchedEffect(revision) {
        while (true) {
            try {
                deadline = withContext(Dispatchers.IO) { LightSetup.undoDeadline(activity) }
                break
            } catch (e: java.io.IOException) {
                if (e is HttpError && e.status in 400..499 && e.status != 429) break
                delay(5_000)
            }
        }
        if (deadline > 0) delay((deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
        deadline = 0
    }
    if (deadline > 0) {
        TextButton(onClick = {
            val accepted = LightSetup.requestUndo(activity, deadline)
            deadline = 0L
            if (accepted) {
                SyncScheduler.ensurePeriodic(activity)
                SyncScheduler.now(activity, "undo setup")
                onUndo()
            }
        }) { Text(stringResource(R.string.setup_undo)) }
    } else if (SyncStore(activity).setupUndoPending && !SyncStore(activity).removed) {
        Text(stringResource(R.string.setup_undo_requested))
    }
}
