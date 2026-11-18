// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.os.SystemClock
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import kotlinx.coroutines.delay
import org.plainphone.app.R

@Composable
internal fun UndoSetupAction(activity: ComponentActivity, revision: Int) {
    var deadline by remember(revision) { mutableLongStateOf(LightSetup.localUndoDeadline(activity)) }
    var status by remember { mutableIntStateOf(0) }
    LaunchedEffect(deadline) {
        if (deadline > 0) {
            delay((deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
            deadline = 0
        }
    }
    if (status != 0) {
        Text(stringResource(status), Modifier.semantics { liveRegion = LiveRegionMode.Polite })
    }
    if (deadline > 0) {
        TextButton(onClick = {
            val accepted = LightSetup.undo(activity)
            deadline = if (accepted) 0 else LightSetup.localUndoDeadline(activity)
            status = when {
                accepted -> R.string.setup_undo_requested
                deadline == 0L -> R.string.setup_undo_closed
                else -> 0
            }
        }) { Text(stringResource(R.string.setup_undo)) }
    }
}
