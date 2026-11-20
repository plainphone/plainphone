// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.PathBuilder
import androidx.compose.ui.graphics.vector.path
import androidx.compose.ui.unit.dp

/**
 * The Phone and Messages icons in the brand's own style (docs/brand/README.md, "Icons"): a 24-unit
 * grid, 2-unit round strokes and no fills. [Icon][androidx.compose.material3.Icon] tints them with
 * the content colour. Icons that carry meaning always sit next to a text label or have one for
 * the screen reader.
 */
object PlainIcons {
    private fun icon(name: String, block: PathBuilder.() -> Unit): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).path(
            fill = null,
            stroke = SolidColor(Color.Black),
            strokeLineWidth = 2f,
            strokeLineCap = StrokeCap.Round,
            strokeLineJoin = StrokeJoin.Round,
            pathBuilder = block,
        ).build()

    private fun PathBuilder.circle(cx: Float, cy: Float, r: Float) {
        moveTo(cx - r, cy)
        arcTo(r, r, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = cx + r, y1 = cy)
        arcTo(r, r, 0f, isMoreThanHalf = true, isPositiveArc = true, x1 = cx - r, y1 = cy)
        close()
    }

    /** A handset: call, call back, answer. */
    val Phone: ImageVector = icon("phone") {
        moveTo(6f, 3.5f)
        lineTo(9f, 3.5f)
        lineTo(10.5f, 8f)
        lineTo(8.5f, 9.5f)
        curveTo(9.5f, 11.8f, 12.2f, 14.5f, 14.5f, 15.5f)
        lineTo(16f, 13.5f)
        lineTo(20.5f, 15f)
        lineTo(20.5f, 18f)
        curveTo(20.5f, 19.4f, 19.4f, 20.5f, 18f, 20.5f)
        curveTo(10f, 20f, 4f, 14f, 3.5f, 6f)
        curveTo(3.5f, 4.6f, 4.6f, 3.5f, 6f, 3.5f)
        close()
    }

    /** A speech bubble: messages. */
    val Message: ImageVector = icon("message") {
        moveTo(5f, 4.5f)
        lineTo(19f, 4.5f)
        curveTo(20.1f, 4.5f, 21f, 5.4f, 21f, 6.5f)
        lineTo(21f, 15f)
        curveTo(21f, 16.1f, 20.1f, 17f, 19f, 17f)
        lineTo(10f, 17f)
        lineTo(6f, 20.5f)
        lineTo(6f, 17f)
        lineTo(5f, 17f)
        curveTo(3.9f, 17f, 3f, 16.1f, 3f, 15f)
        lineTo(3f, 6.5f)
        curveTo(3f, 5.4f, 3.9f, 4.5f, 5f, 4.5f)
        close()
    }

    /** A head and shoulders: people. */
    val Person: ImageVector = icon("person") {
        circle(12f, 8f, 4f)
        moveTo(4.5f, 20.5f)
        curveTo(4.5f, 16.5f, 7.8f, 14f, 12f, 14f)
        curveTo(16.2f, 14f, 19.5f, 16.5f, 19.5f, 20.5f)
    }

    /** A clock face: recent calls. */
    val Clock: ImageVector = icon("clock") {
        circle(12f, 12f, 9f)
        moveTo(12f, 7f)
        lineTo(12f, 12f)
        lineTo(15f, 14f)
    }

    /** Nine keys and a zero: the keypad. */
    val Keypad: ImageVector = icon("keypad") {
        for (y in listOf(4f, 10f, 16f)) for (x in listOf(6f, 12f, 18f)) circle(x, y, 0.6f)
        circle(12f, 21f, 0.6f)
    }

    /** A crossed-out microphone: mute. */
    val MicOff: ImageVector = icon("mic-off") {
        moveTo(9f, 6f)
        curveTo(9f, 4.3f, 10.3f, 3f, 12f, 3f)
        curveTo(13.7f, 3f, 15f, 4.3f, 15f, 6f)
        lineTo(15f, 11f)
        curveTo(15f, 12.7f, 13.7f, 14f, 12f, 14f)
        curveTo(10.3f, 14f, 9f, 12.7f, 9f, 11f)
        close()
        moveTo(5f, 11f)
        curveTo(5f, 14.9f, 8.1f, 18f, 12f, 18f)
        curveTo(15.9f, 18f, 19f, 14.9f, 19f, 11f)
        moveTo(12f, 18f)
        lineTo(12f, 21f)
        moveTo(3.5f, 3.5f)
        lineTo(20.5f, 20.5f)
    }

    /** A loudspeaker: speaker. */
    val Speaker: ImageVector = icon("speaker") {
        moveTo(4f, 9f)
        lineTo(8f, 9f)
        lineTo(13f, 5f)
        lineTo(13f, 19f)
        lineTo(8f, 15f)
        lineTo(4f, 15f)
        close()
        moveTo(16.5f, 9f)
        curveTo(18f, 10.5f, 18f, 13.5f, 16.5f, 15f)
        moveTo(19f, 6.5f)
        curveTo(22f, 9.5f, 22f, 14.5f, 19f, 17.5f)
    }

    val Back: ImageVector = icon("back") {
        moveTo(19f, 12f)
        lineTo(5f, 12f)
        moveTo(11f, 6f)
        lineTo(5f, 12f)
        lineTo(11f, 18f)
    }

    /** An arrow up: send. */
    val Send: ImageVector = icon("send") {
        moveTo(12f, 19f)
        lineTo(12f, 5f)
        moveTo(6f, 11f)
        lineTo(12f, 5f)
        lineTo(18f, 11f)
    }

    val Check: ImageVector = icon("check") {
        moveTo(5f, 12.5f)
        lineTo(9.5f, 17f)
        lineTo(19f, 7f)
    }

    /** A house: "I'm home". */
    val Home: ImageVector = icon("home") {
        moveTo(3.5f, 11f)
        lineTo(12f, 4f)
        lineTo(20.5f, 11f)
        moveTo(6f, 9f)
        lineTo(6f, 20f)
        lineTo(18f, 20f)
        lineTo(18f, 9f)
        moveTo(10f, 20f)
        lineTo(10f, 15f)
        lineTo(14f, 15f)
        lineTo(14f, 20f)
    }

    /** A lifebuoy: help lines. */
    val Help: ImageVector = icon("help") {
        circle(12f, 12f, 9f)
        circle(12f, 12f, 4f)
        moveTo(5.6f, 5.6f)
        lineTo(9.2f, 9.2f)
        moveTo(14.8f, 9.2f)
        lineTo(18.4f, 5.6f)
        moveTo(14.8f, 14.8f)
        lineTo(18.4f, 18.4f)
        moveTo(9.2f, 14.8f)
        lineTo(5.6f, 18.4f)
    }

    /** A call that came in; also a missed call (with the word "Missed"). */
    val Incoming: ImageVector = icon("incoming") {
        moveTo(17f, 7f)
        lineTo(7f, 17f)
        moveTo(7f, 9f)
        lineTo(7f, 17f)
        lineTo(15f, 17f)
    }

    val Outgoing: ImageVector = icon("outgoing") {
        moveTo(7f, 17f)
        lineTo(17f, 7f)
        moveTo(9f, 7f)
        lineTo(17f, 7f)
        lineTo(17f, 15f)
    }

    val Plus: ImageVector = icon("plus") {
        moveTo(12f, 5f)
        lineTo(12f, 19f)
        moveTo(5f, 12f)
        lineTo(19f, 12f)
    }

    /** Delete the last digit. */
    val Backspace: ImageVector = icon("backspace") {
        moveTo(8f, 5f)
        lineTo(20f, 5f)
        curveTo(20.6f, 5f, 21f, 5.4f, 21f, 6f)
        lineTo(21f, 18f)
        curveTo(21f, 18.6f, 20.6f, 19f, 20f, 19f)
        lineTo(8f, 19f)
        lineTo(2.5f, 12f)
        close()
        moveTo(11f, 9f)
        lineTo(17f, 15f)
        moveTo(17f, 9f)
        lineTo(11f, 15f)
    }
}
