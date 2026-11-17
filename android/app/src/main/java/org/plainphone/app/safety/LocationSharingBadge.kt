// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.plainphone.app.R

/**
 * A quiet line for Plainphone's home screens: "Your location is shared with your parent", shown
 * whenever the parent chose "always on". Renders nothing otherwise.
 */
@Composable
fun LocationSharingBadge(
    modifier: Modifier = Modifier,
    shared: Boolean = SafetyStore(LocalContext.current).sharingAlways,
    untilText: String? = null,
    onClick: (() -> Unit)? = null,
) {
    if (!shared) return
    Row(
        modifier
            .fillMaxWidth()
            .let { if (onClick != null) it.clickable(onClick = onClick) else it }
            .background(MaterialTheme.colorScheme.secondaryContainer, RoundedCornerShape(14.dp))
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(10.dp).background(MaterialTheme.colorScheme.primary, CircleShape))
        Spacer(Modifier.size(12.dp))
        Text(
            if (untilText != null) stringResource(R.string.location_always_badge_until, untilText) else stringResource(R.string.location_always_title),
            fontSize = 15.sp,
            color = MaterialTheme.colorScheme.onSecondaryContainer,
        )
    }
}
