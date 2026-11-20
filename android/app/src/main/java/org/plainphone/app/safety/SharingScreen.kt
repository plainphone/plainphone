// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R
import org.plainphone.app.light.CalmScreen
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.ui.PlainphoneTheme

/**
 * "What can my parents see?": the location mode in plain words, and every time this phone sent
 * its position in the last 30 days (kept only on the phone). Children have a right to know.
 */
class SharingActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PlainphoneTheme {
                val store = SafetyStore(this)
                val rules = SyncStore(this).rules()
                SharingScreen(
                    mode = store.locationMode ?: ServerRules.LOCATION_OFF,
                    weeklySummary = rules?.profile == "child" && rules.weeklySummaryEnabled,
                    alwaysUntilMs = store.alwaysUntilMs,
                    log = store.sharingLog(),
                    format = { Safety.dateTime(this, it) },
                    onClose = { finish() },
                )
            }
        }
    }

    companion object {
        fun intent(context: Context) = Intent(context, SharingActivity::class.java)
    }
}

@Composable
fun SharingScreen(
    mode: String,
    alwaysUntilMs: Long?,
    log: List<SharingEntry>,
    format: (Long) -> String,
    weeklySummary: Boolean = false,
    onClose: () -> Unit,
) {
    val modeText = when (mode) {
        ServerRules.LOCATION_FIND -> stringResource(R.string.sharing_mode_find)
        ServerRules.LOCATION_CHECKIN -> stringResource(R.string.sharing_mode_checkin)
        ServerRules.LOCATION_ALWAYS -> if (alwaysUntilMs != null) {
            stringResource(R.string.sharing_mode_always, format(alwaysUntilMs))
        } else {
            stringResource(R.string.sharing_mode_always_open)
        }
        else -> stringResource(R.string.sharing_mode_off)
    }
    CalmScreen(
        eyebrow = stringResource(R.string.app_name),
        title = stringResource(R.string.sharing_title),
        body = modeText,
        primary = stringResource(android.R.string.ok),
        onPrimary = onClose,
    ) {
        if (mode != ServerRules.LOCATION_OFF) {
            Text(stringResource(R.string.sharing_only_latest), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        // Principle 1: the child is told what else the parents see, in plain words.
        if (weeklySummary) {
            Text(stringResource(R.string.sharing_weekly_summary), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        Spacer(Modifier.size(8.dp))
        Text(stringResource(R.string.sharing_latest), fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        if (log.isEmpty()) {
            Text(stringResource(R.string.sharing_none), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        } else {
            Column {
                log.forEachIndexed { i, e ->
                    if (i > 0) HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    LogRow(e, format)
                }
            }
        }
        Text(stringResource(R.string.sharing_log_note), fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun LogRow(e: SharingEntry, format: (Long) -> String) {
    val why = when (e.why) {
        "checkin" -> stringResource(R.string.sharing_why_checkin)
        "always" -> stringResource(R.string.sharing_why_always)
        else -> stringResource(R.string.sharing_why_find)
    }
    val whenText = if (e.firstMs == e.lastMs) format(e.lastMs) else stringResource(R.string.sharing_range, format(e.firstMs), format(e.lastMs))
    Column(Modifier.fillMaxWidth().padding(vertical = 10.dp)) {
        Text(why, fontSize = 16.sp)
        Text(whenText, fontSize = 14.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

/**
 * For Plainphone's home screens: a quiet "Your location is shared until 14:05" whenever the parent
 * chose "always", and otherwise a small "What can my parents see?". Both open [SharingActivity].
 */
@Composable
fun LocationSharingLine(
    modifier: Modifier = Modifier,
    shared: Boolean = SafetyStore(LocalContext.current).sharingAlways,
    untilText: String? = SafetyStore(LocalContext.current).alwaysUntilMs?.let { Safety.dateTime(LocalContext.current, it) },
) {
    val context = LocalContext.current
    val open = { context.startActivity(SharingActivity.intent(context)) }
    if (shared) {
        LocationSharingBadge(modifier, shared = true, untilText = untilText, onClick = open)
    } else {
        Text(
            stringResource(R.string.sharing_open),
            fontSize = 15.sp,
            color = MaterialTheme.colorScheme.primary,
            modifier = modifier.clickable(onClick = open).padding(vertical = 8.dp),
        )
    }
}
