// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R

/**
 * What the guard shows instead of a blocked app: the reason, the next available step, and a
 * route to a parent that is always there (parents' reachability cannot be switched off).
 * Static on purpose: no animation, no vibration, no countdown.
 */
@Composable
fun BlockedScreen(
    reason: BlockedActivity.Reason,
    appLabel: String?,
    onHome: () -> Unit,
    onReachParent: () -> Unit,
    onEnterPin: () -> Unit,
    showParent: Boolean = true,
) {
    val title: Int
    val body: Int
    when (reason) {
        BlockedActivity.Reason.NOT_ALLOWED -> { title = R.string.blocked_not_allowed_title; body = R.string.blocked_not_allowed_body }
        BlockedActivity.Reason.TIME_USED_UP -> { title = R.string.blocked_time_title; body = R.string.blocked_time_body }
        BlockedActivity.Reason.PROTECTION -> { title = R.string.blocked_protection_title; body = R.string.blocked_protection_body }
        BlockedActivity.Reason.OTHER -> { title = R.string.blocked_other_title; body = R.string.blocked_other_body }
    }
    val pin = reason == BlockedActivity.Reason.PROTECTION
    CalmScreen(
        eyebrow = appLabel.takeIf { reason != BlockedActivity.Reason.PROTECTION },
        title = stringResource(title),
        body = stringResource(body),
        primary = stringResource(R.string.blocked_ok),
        onPrimary = onHome,
        secondary = if (pin) stringResource(R.string.blocked_enter_pin) else null,
        onSecondary = onEnterPin,
    ) {
        // Not for the Self profile: there is no parent, and the button would open the user's own favourites.
        if (showParent) OutlinedButton(
            onClick = onReachParent,
            modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
            shape = RoundedCornerShape(16.dp),
        ) { Text(stringResource(R.string.blocked_reach_parent), fontSize = 17.sp) }
    }
}
