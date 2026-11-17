// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.ui.ApprovedContactsActivity
import org.plainphone.app.ui.PairingActivity
import org.plainphone.app.update.InstallWatchdogService
import org.plainphone.app.update.UpdateReceiver

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
            text = getString(R.string.maintenance_contacts)
            setOnClickListener {
                startActivity(Intent(this@MaintenanceActivity, ApprovedContactsActivity::class.java))
            }
        })
        if (!SyncStore(this).isPaired) {
            column.addView(Button(this).apply {
                text = getString(R.string.maintenance_pair)
                setOnClickListener {
                    startActivity(PairingActivity.intent(this@MaintenanceActivity, authorized = true))
                    finish()
                }
            })
        } else {
            column.addView(Button(this).apply {
                text = getString(R.string.maintenance_sync_now)
                setOnClickListener {
                    SyncScheduler.now(this@MaintenanceActivity, "maintenance screen")
                    output.text = getString(R.string.maintenance_sync_started)
                }
            })
        }
        val light = org.plainphone.app.light.Mode.isLight(this)
        if (!light && !InstallWatchdogService.hasBatteryExemption(this)) {
            column.addView(Button(this).apply {
                text = getString(R.string.light_battery_settings)
                setOnClickListener {
                    val settings = Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)
                    runCatching { startActivity(settings) }
                        .onFailure { startActivity(Intent(Settings.ACTION_SETTINGS)) }
                }
            })
        }
        if (!light && Build.VERSION.SDK_INT >= 31 && !UpdateReceiver.canScheduleExactExpiry(this)) {
            column.addView(Button(this).apply {
                text = getString(R.string.maintenance_install_alarm_access)
                setOnClickListener {
                    runCatching {
                        startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:$packageName")))
                    }.onFailure { output.text = getString(R.string.maintenance_install_alarm_settings) }
                }
            })
        }
        val releaseTitle = if (light) R.string.maintenance_release_light else R.string.maintenance_release
        column.addView(Button(this).apply {
            text = getString(releaseTitle)
            setOnClickListener {
                AlertDialog.Builder(this@MaintenanceActivity)
                    .setTitle(releaseTitle)
                    .setMessage(if (light) R.string.maintenance_release_light_confirm else R.string.maintenance_release_confirm)
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
