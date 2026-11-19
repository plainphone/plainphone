// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * The 5-minute warning as one calm line on the home screen, like the school-time notice: a short
 * accent bar and the same words as the notification. No countdown, no colour that carries meaning.
 */
@Composable
fun LimitWarningNotice(text: String, modifier: Modifier = Modifier) {
    val c = LocalHomeColors.current
    Row(modifier.height(IntrinsicSize.Min).heightIn(min = 24.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(3.dp).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(c.accent))
        Spacer(Modifier.width(12.dp))
        Text(text, color = c.ink, fontSize = 17.sp, lineHeight = 24.sp)
    }
}
