// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.accounts.AccountManager
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.provider.Settings
import android.text.InputType
import java.util.Date
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import org.plainphone.app.catalog.CatalogAccounts
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.update.InstallLease
import org.plainphone.app.light.Mode
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
    private val handler = Handler(Looper.getMainLooper())
    private var checkFallbackExpiry: Runnable? = null
    private var stateView: TextView? = null
    private var reapplyButton: Button? = null
    private val installPackage by lazy { intent.getStringExtra(EXTRA_INSTALL_PACKAGE) }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        val pad = (20 * resources.displayMetrics.density).toInt()
        column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }
        column.addView(TextView(this).apply {
            text = getString(if (installPackage == null) R.string.maintenance_title else R.string.today_install_with_account)
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

    override fun onResume() {
        super.onResume()
        checkFallbackExpiry?.run()
    }

    override fun onDestroy() {
        cancelFallbackExpiry()
        super.onDestroy()
    }

    private fun cancelFallbackExpiry() {
        checkFallbackExpiry?.let(handler::removeCallbacks)
        checkFallbackExpiry = null
    }

    private fun showPinPrompt() {
        val pin = EditText(this).apply {
            hint = getString(R.string.maintenance_pin_hint)
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        }
        val message = TextView(this).apply { accessibilityLiveRegion = android.view.View.ACCESSIBILITY_LIVE_REGION_POLITE }
        val button = Button(this).apply { text = getString(R.string.maintenance_unlock) }
        val fallback = Button(this).apply {
            id = R.id.maintenance_allow_accounts
            setText(R.string.maintenance_allow_accounts)
            visibility = View.GONE
        }
        val throttle = PinThrottle.forContext(this)
        button.setOnClickListener {
            val waitSeconds = ((throttle.remainingMs() + 999) / 1000).toInt()
            if (waitSeconds > 0) {
                message.text = resources.getQuantityString(R.plurals.maintenance_wait, waitSeconds, waitSeconds)
                return@setOnClickListener
            }
            val entered = pin.text.toString()
            fallback.visibility = View.GONE
            cancelFallbackExpiry()
            pin.text.clear()
            button.isEnabled = false
            // PBKDF2 takes a moment on slow phones: keep it off the UI thread.
            Thread {
                val config = ConfigStore(this).load()
                val ok = (installPackage == null || !config.usesDefaultPin) && MaintenancePin.verify(entered, config)
                if (ok) throttle.onSuccess() else throttle.onFailure()
                runOnUiThread {
                    button.isEnabled = true
                    if (isFinishing || isDestroyed) return@runOnUiThread
                    val pkg = installPackage
                    if (ok && pkg != null) {
                        val app = applicationContext
                        button.isEnabled = false
                        Thread {
                            val result = InstallWindow.openForParent(app, pkg)
                            runOnUiThread installResult@{
                                if (isFinishing || isDestroyed) return@installResult
                                when (result) {
                                    InstallWindow.OpenResult.OPENED -> {
                                        if (Mode.isStrong(this)) {
                                            addPlayAccount(pkg, message, button, fallback)
                                            return@installResult
                                        }
                                        openPlay(pkg)
                                    }
                                    InstallWindow.OpenResult.DAILY_LIMIT ->
                                        message.setText(R.string.maintenance_install_limit)
                                    InstallWindow.OpenResult.UNAVAILABLE ->
                                        message.setText(R.string.maintenance_install_unavailable)
                                    InstallWindow.OpenResult.BATTERY_EXEMPTION_NEEDED ->
                                        message.setText(R.string.maintenance_install_battery)
                                    InstallWindow.OpenResult.OPEN_FAILED ->
                                        message.setText(R.string.maintenance_install_open_failed)
                                }
                                button.isEnabled = true
                            }
                        }.start()
                    } else if (ok) {
                        column.removeView(pin); column.removeView(button); column.removeView(message)
                        showActions()
                    } else {
                        message.text = getString(R.string.maintenance_wrong_pin)
                        pin.requestFocus()
                    }
                }
            }.start()
        }
        column.addView(pin)
        column.addView(button)
        column.addView(message)
        if (installPackage != null) column.addView(fallback)
    }

    private fun addPlayAccount(
        pkg: String, message: TextView, button: Button, fallback: Button,
        leaseId: String? = null, fallbackId: String? = null,
    ) {
        val app = applicationContext
        fun unavailable() {
            fallback.visibility = View.GONE
            message.setText(R.string.maintenance_install_account_unavailable)
            button.isEnabled = true
        }
        fun failed(request: CatalogAccounts.Request) {
            if (isFinishing || isDestroyed) return
            unavailable()
            if (request.fallback) return
            val expiry = object : Runnable {
                override fun run() {
                    handler.removeCallbacks(this)
                    val remaining = InstallLease.android(app).catalogRemainingMs(request.leaseId)
                    if (remaining > 0 && InstallWindow.current(app) == pkg) {
                        handler.postDelayed(this, remaining)
                    } else {
                        cancelFallbackExpiry()
                        unavailable()
                    }
                }
            }
            cancelFallbackExpiry()
            checkFallbackExpiry = expiry
            fallback.setOnClickListener {
                val deadline = SystemClock.elapsedRealtime() + CatalogAccounts.FALLBACK_MS
                expiry.run()
                if (fallback.visibility != View.VISIBLE) return@setOnClickListener
                cancelFallbackExpiry()
                fallback.visibility = View.GONE
                button.isEnabled = false
                message.text = ""
                Thread {
                    val lease = InstallLease.android(app)
                    val armed = runCatching { lease.armCatalogAccounts(request.leaseId, deadline) }
                    runOnUiThread {
                        val id = armed.getOrNull()
                        if (id == null) {
                            if (!isFinishing && !isDestroyed) unavailable()
                        } else if (isFinishing || isDestroyed) {
                            lease.finishCatalogAccounts(id)
                        } else {
                            addPlayAccount(pkg, message, button, fallback, request.leaseId, id)
                        }
                    }
                }.start()
            }
            message.setText(R.string.maintenance_install_account_failed)
            fallback.visibility = View.VISIBLE
            expiry.run()
        }
        // The device owner can ask Android to add an account while user account changes stay blocked.
        val request = runCatching { CatalogAccounts.start(app, pkg, leaseId, fallbackId) }.getOrElse {
            fallbackId?.let { InstallLease.android(app).finishCatalogAccounts(it) }
            unavailable()
            return
        }
        if (request == null) {
            fallbackId?.let { InstallLease.android(app).finishCatalogAccounts(it) }
            message.setText(R.string.maintenance_install_account_pending)
            button.isEnabled = true
            return
        }
        val started = runCatching {
            AccountManager.get(this).addAccount(CatalogAccounts.GOOGLE, null, null, Bundle(), this, {
                val added = runCatching { CatalogAccounts.complete(app, request) }
                    .onFailure { android.util.Log.w("Plainphone", "Could not finish Google sign-in", it) }
                    .getOrDefault(false)
                if (!isFinishing && !isDestroyed) {
                    if (added) {
                        if (InstallLease.android(app).catalogId() == request.leaseId) openPlay(pkg) else finish()
                    } else failed(request)
                }
            }, null)
        }.isSuccess
        if (!started) {
            runCatching { CatalogAccounts.complete(app, request) }
            failed(request)
        }
    }

    private fun openPlay(pkg: String) {
        if (InstallWindow.current(this) == pkg) InstallWindow.launchPlay(this, pkg)
        finish()
    }

    private fun showActions() {
        val config = ConfigStore(this).load()
        stateView = TextView(this).apply {
            textSize = 18f
            setTypeface(typeface, Typeface.BOLD)
            accessibilityLiveRegion = View.ACCESSIBILITY_LIVE_REGION_POLITE
        }
        column.addView(stateView)
        column.addView(TextView(this).apply { text = getString(R.string.server_current, config.serverUrl) })
        org.plainphone.app.sync.SyncStore(this).rules()?.let { rules ->
            column.addView(TextView(this).apply {
                text = getString(if (rules.allowServerMove) R.string.server_move_allowed else R.string.server_move_blocked)
            })
        }
        val minutes = config.relockMinutes
        column.addView(Button(this).apply {
            text = resources.getQuantityString(R.plurals.maintenance_lift, minutes, minutes)
            setOnClickListener { Lock.liftAsync(this@MaintenanceActivity, ::show) }
        })
        reapplyButton = Button(this).apply {
            text = getString(R.string.maintenance_reapply)
            setOnClickListener { Lock.applyAsync(this@MaintenanceActivity, "maintenance screen", ::show) }
        }
        column.addView(reapplyButton)
        refreshState()
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

    companion object {
        const val EXTRA_INSTALL_PACKAGE = "org.plainphone.app.INSTALL_PACKAGE"
    }

    private fun show(results: List<StepResult>) = runOnUiThread {
        output.text = results.joinToString("\n")
        refreshState()
    }

    /** Leads with the lock state and, while an unlock is open, when it ends and how to end it now. */
    private fun refreshState() {
        val endsAt = Lock.maintenanceEndsAtMs(this)
        stateView?.text = if (endsAt == null) {
            getString(R.string.maintenance_state_locked)
        } else {
            getString(R.string.maintenance_state_lifted, android.text.format.DateFormat.getTimeFormat(this).format(Date(endsAt)))
        }
        reapplyButton?.setText(if (endsAt == null) R.string.maintenance_reapply else R.string.maintenance_lock_now)
    }
}
