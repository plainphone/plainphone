// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R
import org.plainphone.app.safety.SharingActivity

/** At most this many lines are on the home screen; "See all" opens the full agreement. */
const val HOME_AGREEMENT_LINES = 3

/** The lines that fit on the home screen, and whether there are more. */
fun homeAgreementPreview(lines: List<String>): Pair<List<String>, Boolean> =
    lines.take(HOME_AGREEMENT_LINES) to (lines.size > HOME_AGREEMENT_LINES)

/**
 * A calm card with the family's agreement, when the parents chose to show it on the home screen
 * (docs/family-agreement.md). It sits in the scrolling column, so Phone and the emergency call in
 * the dock are never pushed out of reach.
 */
@Composable
fun AgreementCard(lines: List<String>) {
    val c = LocalHomeColors.current
    val context = LocalContext.current
    val (shown, more) = homeAgreementPreview(lines)
    Column(
        Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(c.surface)
            .padding(16.dp),
    ) {
        Text(
            stringResource(R.string.agreement_title),
            color = c.muted,
            fontSize = 15.sp,
            fontWeight = FontWeight.Medium,
            modifier = Modifier.semantics { heading() },
        )
        Spacer(Modifier.height(6.dp))
        shown.forEach { Text(it, color = c.ink, fontSize = 17.sp, modifier = Modifier.padding(vertical = 2.dp)) }
        if (more) {
            Text(
                stringResource(R.string.agreement_see_all),
                color = c.accent,
                fontSize = 16.sp,
                fontWeight = FontWeight.Medium,
                modifier = Modifier
                    .clickable(role = Role.Button) { context.startActivity(SharingActivity.intent(context)) }
                    .heightIn(min = 48.dp)
                    .padding(top = 8.dp),
            )
        }
    }
}
