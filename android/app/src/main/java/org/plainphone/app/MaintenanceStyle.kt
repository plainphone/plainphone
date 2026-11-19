// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.content.Context
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.StateListDrawable
import android.util.TypedValue
import android.view.Gravity
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.compose.ui.graphics.toArgb
import org.plainphone.app.ui.PlainTokens

/**
 * The common tokens (ui/Tokens.kt) applied to the Maintenance screen's plain views: system font
 * with its own fallback, sp text that wraps at large sizes, 48 dp targets, a visible focus ring
 * and AA contrast in light and dark. Nothing here changes what the screen does.
 */
class MaintenanceStyle(private val context: Context) {
    val tokens: PlainTokens = if (
        context.resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
    ) PlainTokens.Dark else PlainTokens.Light

    private val density = context.resources.displayMetrics.density
    fun dp(value: Int) = (value * density).toInt()

    val paper get() = tokens.paper.toArgb()
    val ink get() = tokens.ink.toArgb()
    private val pencil get() = tokens.pencil.toArgb()
    private val action get() = tokens.action.toArgb()
    private val danger get() = tokens.danger.toArgb()
    private val outline get() = tokens.outline.toArgb()

    /** 16 dp inset, 32 dp from the top so the title clears the status bar. */
    fun screen(column: LinearLayout) {
        column.setBackgroundColor(paper)
        column.setPadding(dp(16), dp(32), dp(16), dp(24))
    }

    fun title(view: TextView) = view.apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 24f)
        setTypeface(Typeface.DEFAULT, Typeface.BOLD)
        setTextColor(ink)
        setPadding(0, 0, 0, dp(12))
        isAccessibilityHeading = true
    }

    fun body(view: TextView) = view.apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setLineSpacing(0f, 1.25f)
        setTextColor(ink)
        setPadding(0, dp(4), 0, dp(8))
    }

    /** Messages under the PIN field are errors (danger red) unless [tone] says they are just a status. */
    fun message(view: TextView) = body(view).apply { setTextColor(danger) }

    /** Red for something the parent has to fix, ink for a neutral status such as "in progress". */
    fun tone(view: TextView, error: Boolean) = view.setTextColor(if (error) danger else ink)

    /** Token colour for a dialog button that is not the destructive one. */
    val actionColor get() = action

    fun log(view: TextView) = view.apply {
        typeface = Typeface.MONOSPACE
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 14f)
        setTextColor(pencil)
        setPadding(0, dp(16), 0, dp(16))
    }

    fun field(view: EditText) = view.apply {
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 18f)
        setTextColor(ink)
        setHintTextColor(pencil)
        minimumHeight = dp(48)
        setPadding(dp(12), dp(8), dp(12), dp(8))
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), shape(tokens.sheet.toArgb(), action, 3))
            addState(intArrayOf(), shape(tokens.sheet.toArgb(), outline, 1))
        }
    }

    enum class Kind { PRIMARY, SECONDARY, DANGER }

    fun button(view: Button, kind: Kind = Kind.SECONDARY) = view.apply {
        isAllCaps = false
        setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
        setTypeface(Typeface.DEFAULT, Typeface.BOLD)
        minHeight = dp(48)
        minimumHeight = dp(48)
        gravity = Gravity.CENTER
        setPadding(dp(16), dp(10), dp(16), dp(10))
        val fill = if (kind == Kind.PRIMARY) action else tokens.sheet.toArgb()
        val border = when (kind) {
            Kind.PRIMARY -> action
            Kind.SECONDARY -> outline
            Kind.DANGER -> danger
        }
        val text = when (kind) {
            Kind.PRIMARY -> tokens.onAction.toArgb()
            Kind.SECONDARY -> ink
            Kind.DANGER -> danger
        }
        setTextColor(
            ColorStateList(
                arrayOf(intArrayOf(-android.R.attr.state_enabled), intArrayOf()),
                intArrayOf(pencil, text),
            ),
        )
        // Focus and press show as a thick ink outline, so they read against both fills.
        background = StateListDrawable().apply {
            addState(intArrayOf(android.R.attr.state_focused), shape(fill, ink, 3))
            addState(intArrayOf(android.R.attr.state_pressed), shape(fill, ink, 3))
            addState(intArrayOf(-android.R.attr.state_enabled), shape(tokens.divider.toArgb(), tokens.divider.toArgb(), 1))
            addState(intArrayOf(), shape(fill, border, 1))
        }
        stateListAnimator = null
        layoutParams = LinearLayout.LayoutParams(
            LinearLayout.LayoutParams.MATCH_PARENT, LinearLayout.LayoutParams.WRAP_CONTENT,
        ).apply { topMargin = dp(12) }
    }

    private fun shape(fill: Int, stroke: Int, strokeDp: Int) = GradientDrawable().apply {
        cornerRadius = dp(10).toFloat()
        setColor(fill)
        setStroke(dp(strokeDp), stroke)
    }
}
