// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import android.content.Intent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

/** What the stop screen knows about the openings: how many are left this month and how long one lasts. */
data class EmergencyOffer(val left: Int, val minutes: Int)

/**
 * "Emergency opening" on the stop screen of a Self phone (light mode). State is hoisted: the screen
 * owns [confirming] and [message]. With none left it only says so, and shows no button.
 */
@Composable
internal fun EmergencySection(
    offer: EmergencyOffer,
    appLabel: String?,
    confirming: Boolean,
    message: Int?,
    onStart: () -> Unit,
    onOpen: () -> Unit,
    onCancel: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        when {
            offer.left <= 0 -> Text(
                stringResource(R.string.emergency_none_left),
                fontSize = 15.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            confirming -> {
                val app = appLabel ?: stringResource(R.string.emergency_this_app)
                Text(stringResource(R.string.emergency_confirm_title, app, offer.minutes), fontSize = 17.sp)
                Text(pluralStringResource(R.plurals.emergency_left, offer.left, offer.left), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Text(stringResource(R.string.emergency_confirm_told), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
                Button(onClick = onOpen, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(16.dp)) {
                    Text(stringResource(R.string.emergency_open), fontSize = 17.sp)
                }
                TextButton(onClick = onCancel, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text(stringResource(R.string.emergency_cancel), fontSize = 16.sp)
                }
            }
            else -> {
                OutlinedButton(onClick = onStart, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp), shape = RoundedCornerShape(16.dp)) {
                    Text(stringResource(R.string.emergency_button), fontSize = 17.sp)
                }
                Text(pluralStringResource(R.plurals.emergency_left, offer.left, offer.left), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (message != null) {
            Text(
                stringResource(message),
                fontSize = 15.sp,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }
    }
}

/** One quiet line on the Self phone's Today screen: "Emergency openings: N left this month". */
@Composable
internal fun EmergencyStatusLine() {
    val context = LocalContext.current
    val left = EmergencyController.statusLeft(context) ?: return
    Text(
        pluralStringResource(R.plurals.emergency_status, left, left),
        fontSize = 15.sp,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

/** What tapping "Open" led to. */
sealed interface EmergencyOutcome {
    /** Recorded. The caller starts [launch] and leaves the stop screen. */
    data class Opened(val launch: Intent) : EmergencyOutcome
    data class Refused(val message: Int) : EmergencyOutcome
}

/** The Android side of an opening: reads the rules, records, and asks the sync to report. */
internal class EmergencyController(
    private val context: Context,
    private val pkg: String?,
    private val reason: BlockedActivity.Reason,
) {
    private val store = SyncStore(context)
    private val openings = store.emergencyOpenings

    /** Null when nothing is offered here (light mode, Self profile, switched on, a reason that can be opened). */
    fun offer(): EmergencyOffer? {
        if (!Mode.isLight(context) || pkg == null || pkg == context.packageName) return null
        val rules = store.rules() ?: return null
        val left = openings.offer(reason, rules.profile == "self", rules.selfEmergency, rules.timezone) ?: return null
        return EmergencyOffer(left, rules.selfEmergency.minutes)
    }

    /** Records the opening first, then hands back the launch intent. Works fully offline. */
    fun open(): EmergencyOutcome {
        val target = pkg ?: return EmergencyOutcome.Refused(R.string.emergency_refused)
        val rules = store.rules() ?: return EmergencyOutcome.Refused(R.string.emergency_refused)
        // Strong mode has no guard that could step aside: the feature only exists in light mode.
        if (!Mode.isLight(context)) return EmergencyOutcome.Refused(R.string.emergency_refused)
        val launch = context.packageManager.getLaunchIntentForPackage(target)
            ?: return EmergencyOutcome.Refused(R.string.emergency_refused)
        return when (val r = openings.start(target, reason, rules.profile == "self", rules.selfEmergency, rules.timezone, context.packageName)) {
            is EmergencyStart.Started -> {
                // The guard re-checks the app the moment the window ends.
                runCatching { SyncScheduler.now(context, "emergency opening") }
                EmergencyOutcome.Opened(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
            }
            is EmergencyStart.Refused -> EmergencyOutcome.Refused(
                if (r.why == EmergencyRefusal.BUSY) R.string.emergency_busy else R.string.emergency_refused,
            )
        }
    }

    companion object {
        /** How many are left this month, for the Today screen; null when the feature is not on for this phone. */
        fun statusLeft(context: Context): Int? {
            if (!Mode.isLight(context)) return null
            val store = SyncStore(context)
            val rules = store.rules() ?: return null
            if (rules.profile != "self" || !rules.selfEmergency.enabled) return null
            return store.emergencyOpenings.remaining(rules.selfEmergency, rules.timezone)
        }
    }
}
