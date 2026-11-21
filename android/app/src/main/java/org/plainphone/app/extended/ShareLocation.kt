// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.extended

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.location.LocationManager
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.R
import org.plainphone.app.sync.LocationReader
import org.plainphone.app.ui.plainTokens

/** One position for a snapshot, with the same lookup as Find (a fresh, precise fix within the 30 second budget). */
internal object SnapshotLookup {
    /** Blocking: call it from a background thread. */
    fun run(context: Context): LookupOutcome {
        val granted = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            context.checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED
        val enabled = context.getSystemService(LocationManager::class.java)?.isLocationEnabled == true
        if (!granted || !enabled) return LookupOutcome.of(granted, enabled, null)
        val precise = context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
        return LookupOutcome.of(true, true, LocationReader(context).current(precise = precise, fresh = true))
    }
}

/**
 * "Share where I am": a button, then a confirmation naming exactly who sees it and for how long, and
 * only after Share one lookup. With no permission or no fix nothing is sent and the child is told why.
 */
@Composable
internal fun ShareLocationButton(target: ShareTarget, parentNames: List<String>, minutes: Int, modifier: Modifier = Modifier, enabled: Boolean = true) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val t = plainTokens
    var confirming by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<Int?>(null) }
    val names = SnapshotConfirm.recipients(target, parentNames)
    Column(modifier, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedButton(
            onClick = { message = null; confirming = true },
            enabled = enabled && !working,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            border = BorderStroke(1.dp, if (enabled) t.ink else t.outline),
        ) {
            Text(
                stringResource(if (working) R.string.ext_share_working else R.string.ext_share),
                color = if (enabled) t.ink else t.outline,
                style = MaterialTheme.typography.titleMedium,
            )
        }
        message?.let {
            Text(
                stringResource(it),
                Modifier.semantics { liveRegion = LiveRegionMode.Polite },
                style = MaterialTheme.typography.bodyMedium,
            )
        }
    }
    if (!confirming) return
    val who = if (names.isEmpty()) stringResource(R.string.ext_your_parents) else names.joinToString(", ")
    val (amount, hours) = SnapshotConfirm.duration(minutes)
    val duration = if (hours) pluralStringResource(R.plurals.ext_for_hours, amount, amount) else pluralStringResource(R.plurals.ext_for_minutes, amount, amount)
    AlertDialog(
        onDismissRequest = { confirming = false },
        title = { Text(stringResource(R.string.ext_share_title)) },
        text = { Text(stringResource(R.string.ext_share_text, who, duration)) },
        confirmButton = {
            TextButton(
                onClick = {
                    confirming = false
                    working = true
                    scope.launch {
                        val outcome = withContext(Dispatchers.IO + NonCancellable) {
                            SnapshotLookup.run(context).also {
                                if (it is LookupOutcome.Found) {
                                    ExtendedFamily.queueSnapshot(context, target, it.fix, names)
                                    ExtendedFamily.flushNow(context)
                                }
                            }
                        }
                        message = when (outcome) {
                            is LookupOutcome.Found -> R.string.ext_share_sent
                            LookupOutcome.Off -> R.string.ext_location_off
                            LookupOutcome.NoFix -> R.string.ext_no_fix
                        }
                        working = false
                    }
                },
                modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(stringResource(R.string.ext_share_confirm)) }
        },
        dismissButton = {
            TextButton(onClick = { confirming = false }, modifier = Modifier.heightIn(min = 48.dp)) {
                Text(stringResource(android.R.string.cancel))
            }
        },
    )
}
