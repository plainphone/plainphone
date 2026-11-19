// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R

/**
 * What a parent needs after Android refused a setup step: how many times the runtime permission
 * was denied and whether Android's "restricted settings" block was hit. Kept on disk, so help
 * survives an app restart. A step that is done again clears itself, so nothing here can go stale.
 */
internal object PermissionRecovery {
    private const val PREFS = "plainphone_light_recovery"

    /** After a second denial, or "don't ask again", Android no longer shows its dialog. */
    internal fun needsSettings(denials: Int, canShowRationale: Boolean): Boolean =
        denials >= 2 || (denials >= 1 && !canShowRationale)

    fun denials(context: Context, step: LightSetup.Step): Int = prefs(context).getInt("denied_${step.name}", 0)

    fun recordDenial(context: Context, step: LightSetup.Step) {
        prefs(context).edit().putInt("denied_${step.name}", denials(context, step) + 1).apply()
    }

    /** Android no longer shows its dialog: only App info can grant this now. */
    fun markBlocked(context: Context, step: LightSetup.Step) {
        prefs(context).edit().putBoolean("blocked_${step.name}", true).apply()
    }

    fun blocked(context: Context, step: LightSetup.Step) =
        prefs(context).getBoolean("blocked_${step.name}", false)

    fun markRestricted(context: Context, step: LightSetup.Step) {
        prefs(context).edit().putBoolean("restricted_${step.name}", true).apply()
    }

    fun restricted(context: Context, step: LightSetup.Step) =
        prefs(context).getBoolean("restricted_${step.name}", false)

    fun clear(context: Context, step: LightSetup.Step) {
        prefs(context).edit().remove("denied_${step.name}").remove("blocked_${step.name}")
            .remove("restricted_${step.name}").apply()
    }

    /** Forget the help for every step Android now says is done. */
    fun clearDone(context: Context) {
        for (step in LightSetup.Step.entries) {
            val remembered = denials(context, step) > 0 || blocked(context, step) || restricted(context, step)
            if (remembered && LightSetup.isDone(context, step)) clear(context, step)
        }
    }

    /** One line on what is lost when an optional step is skipped. */
    fun skipEffect(step: LightSetup.Step): Int? = when (step) {
        LightSetup.Step.RUNNING -> R.string.light_skip_effect_running
        LightSetup.Step.LOCATION -> R.string.light_skip_effect_location
        LightSetup.Step.ALWAYS_ON -> R.string.light_skip_effect_alwayson
        else -> null
    }

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}

/** Short, ordered instructions with the literal Android labels, so nothing hides in one long sentence. */
@Composable
internal fun NumberedSteps(steps: List<String>) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        steps.forEachIndexed { index, text ->
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Text(
                    "${index + 1}.",
                    fontSize = 17.sp,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.widthIn(min = 24.dp),
                )
                Text(text, fontSize = 17.sp, lineHeight = 25.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}

/** What to do when Android blocked a step: the step list first, then open App info and Try again. */
@Composable
internal fun PermissionRecoveryScreen(
    title: String,
    intro: String,
    steps: List<String>,
    onOpenSettings: () -> Unit,
    onRetry: () -> Unit,
    onSkip: (() -> Unit)? = null,
    skipEffect: String? = null,
) {
    CalmScreen(
        eyebrow = null,
        title = title,
        body = intro,
        primary = stringResource(R.string.light_app_info),
        onPrimary = onOpenSettings,
        secondary = stringResource(R.string.pairing_retry),
        onSecondary = onRetry,
    ) {
        NumberedSteps(steps)
        if (onSkip != null) {
            OutlinedButton(onClick = onSkip, modifier = Modifier.fillMaxWidth()) {
                Text(stringResource(R.string.light_skip))
            }
            skipEffect?.let { Text(it, fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
    }
}
