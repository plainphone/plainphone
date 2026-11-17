// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp

/** A settings switch, with a second row where Android asks for two related permissions. */
@Composable
internal fun PermissionIllustration(step: LightSetup.Step) {
    val ink = MaterialTheme.colorScheme.primary
    val paper = MaterialTheme.colorScheme.surfaceVariant
    Canvas(Modifier.size(width = 112.dp, height = 112.dp)) {
        val u = size.width / 112f
        drawRoundRect(paper, cornerRadius = CornerRadius(25 * u))
        drawRoundRect(ink, Offset(29 * u, 13 * u), Size(54 * u, 86 * u), CornerRadius(11 * u), style = Stroke(2 * u))
        drawLine(ink, Offset(49 * u, 21 * u), Offset(63 * u, 21 * u), strokeWidth = 2 * u)
        if (step == LightSetup.Step.PAIR) {
            drawLine(ink, Offset(44 * u, 55 * u), Offset(53 * u, 64 * u), strokeWidth = 3 * u)
            drawLine(ink, Offset(53 * u, 64 * u), Offset(69 * u, 46 * u), strokeWidth = 3 * u)
        } else {
            for (y in if (step == LightSetup.Step.RUNNING) listOf(44, 66) else listOf(56)) {
                drawLine(ink, Offset(36 * u, y * u), Offset(49 * u, y * u), strokeWidth = 2 * u)
                drawRoundRect(ink, Offset(54 * u, (y - 6) * u), Size(22 * u, 12 * u), CornerRadius(6 * u))
                drawCircle(paper, 4 * u, Offset(70 * u, y * u))
            }
        }
    }
}
