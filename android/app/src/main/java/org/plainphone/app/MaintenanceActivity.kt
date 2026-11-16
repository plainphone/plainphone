// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.Activity
import android.app.AlertDialog
import android.graphics.Typeface
import android.os.Bundle
import android.text.InputType
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView

/**
 * Hidden parent screen for phase 1 testing, so a test phone can always be
 * opened again without a factory reset. It will be removed or replaced by the
 * server-side key in later phases.
 */
class MaintenanceActivity : Activity() {
    private lateinit var column: LinearLayout
    private lateinit var output: TextView

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val pad = (20 * resources.displayMetrics.density).toInt()
        column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }
        column.addView(TextView(this).apply {
            text = getString(R.string.maintenance_title)
            textSize = 24f
            setTypeface(typeface, Typeface.BOLD)
        })
        output = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 12f
            setPadding(0, pad, 0, pad)
        }
        setContentView(android.widget.ScrollView(this).apply { addView(column) })
        showPinPrompt()
    }

    private fun showPinPrompt() {
        val pin = EditText(this).apply {
            hint = getString(R.string.maintenance_pin_hint)
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val message = TextView(this)
        val button = Button(this).apply { text = getString(R.string.maintenance_unlock) }
        val throttle = PinThrottle.forContext(this)
        button.setOnClickListener {
            val waitSeconds = ((throttle.remainingMs() + 999) / 1000).toInt()
            if (waitSeconds > 0) {
                message.text = resources.getQuantityString(R.plurals.maintenance_wait, waitSeconds, waitSeconds)
                return@setOnClickListener
            }
            val entered = pin.text.toString()
            pin.text.clear()
            button.isEnabled = false
            // PBKDF2 takes a moment on slow phones: keep it off the UI thread.
            Thread {
                val ok = MaintenancePin.verify(entered, ConfigStore(this).load())
                if (ok) throttle.onSuccess() else throttle.onFailure()
                runOnUiThread {
                    button.isEnabled = true
                    if (ok) {
                        column.removeView(pin); column.removeView(button); column.removeView(message)
                        showActions()
                    } else {
                        message.text = getString(R.string.maintenance_wrong_pin)
                    }
                }
            }.start()
        }
        column.addView(pin)
        column.addView(button)
        column.addView(message)
    }

    private fun showActions() {
        val minutes = ConfigStore(this).load().relockMinutes
        column.addView(Button(this).apply {
            text = resources.getQuantityString(R.plurals.maintenance_lift, minutes, minutes)
            setOnClickListener { Lock.liftAsync(this@MaintenanceActivity, ::show) }
        })
        column.addView(Button(this).apply {
            text = getString(R.string.maintenance_reapply)
            setOnClickListener { Lock.applyAsync(this@MaintenanceActivity, "maintenance screen", ::show) }
        })
        column.addView(Button(this).apply {
            text = getString(R.string.maintenance_release)
            setOnClickListener {
                AlertDialog.Builder(this@MaintenanceActivity)
                    .setTitle(R.string.maintenance_release)
                    .setMessage(R.string.maintenance_release_confirm)
                    .setNegativeButton(android.R.string.cancel, null)
                    .setPositiveButton(android.R.string.ok) { _, _ -> Lock.releaseAsync(this@MaintenanceActivity, ::show) }
                    .show()
            }
        })
        column.addView(output)
    }

    private fun show(results: List<StepResult>) = runOnUiThread {
        output.text = results.joinToString("\n")
    }
}
