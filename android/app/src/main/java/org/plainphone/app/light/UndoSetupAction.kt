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
import kotlinx.coroutines.delay
import org.plainphone.app.Lock
import org.plainphone.app.R
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

@Composable
internal fun UndoSetupAction(activity: ComponentActivity, revision: Int, onUndo: () -> Unit) {
    var remaining by remember(revision) { mutableLongStateOf(LightSetup.undoRemaining(activity)) }
    LaunchedEffect(revision) {
        if (remaining > 0) delay(remaining)
        remaining = LightSetup.undoRemaining(activity)
    }
    if (remaining > 0) {
        TextButton(onClick = {
            val accepted = LightSetup.requestUndo(activity)
            remaining = 0L
            if (accepted) {
                SyncScheduler.ensurePeriodic(activity)
                SyncScheduler.now(activity, "undo setup")
                Lock.releaseAsync(activity) { activity.runOnUiThread(onUndo) }
            }
        }) { Text(stringResource(R.string.setup_undo)) }
    } else if (SyncStore(activity).setupUndoPending) {
        Text(stringResource(R.string.setup_undo_requested))
    }
}
