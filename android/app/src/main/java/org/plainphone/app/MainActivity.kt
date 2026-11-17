// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.AlertDialog
import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.util.Log
import android.view.View
import java.text.DateFormat
import java.util.Date
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.LocalContactPolicySource
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.light.HomeActivity
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.LightSetupActivity
import org.plainphone.app.provisioning.BootloaderWarning
import org.plainphone.app.ui.PairingActivity

/**
 * Status screen. Tapping the version line [TAPS_TO_MAINTENANCE] times opens the
 * PIN-protected maintenance screen.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var report: TextView
    private lateinit var pairButton: Button
    private lateinit var todayButton: Button
    private lateinit var sharingLine: TextView
    private var taps = 0
    /** Roles asked for during this visit to the screen (phone app, and on Android 10 to 13 call screening and redirection). */
    private val askedRoles = mutableSetOf<String>()
    private var roleDialogOpen = false
    private var started = false
    private val localBootWarning by lazy { BootloaderWarning.reportsUnlocked() }

    override fun onStart() {
        super.onStart()
        started = true
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // Light mode (installed as an ordinary app): setup first, then the "Today" screen.
        if (!isDeviceOwner() && intent?.action != DevicePolicyManager.ACTION_PROVISIONING_SUCCESSFUL) {
            val destination = if (LightSetup.isComplete(this)) HomeActivity.intent(this) else
                LightSetupActivity.intent(this).apply {
                    if (intent?.action == Intent.ACTION_VIEW) {
                        data = intent.data
                        addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
                    }
                }
            startActivity(destination)
            finish()
            return
        }
        val pad = (20 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }
        column.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 28f
            setTypeface(typeface, Typeface.BOLD)
        })
        column.addView(TextView(this).apply {
            text = getString(R.string.phase_notice)
            textSize = 15f
            setPadding(0, pad / 2, 0, pad)
        })
        // Strong mode's own home: "always" location is shown here too, not only in the notification.
        sharingLine = TextView(this).apply {
            textSize = 16f
            setPadding(0, 0, 0, pad / 2)
            setOnClickListener { startActivity(org.plainphone.app.safety.SharingActivity.intent(this@MainActivity)) }
        }
        column.addView(sharingLine)
        status = TextView(this).apply { textSize = 17f }
        column.addView(status)
        pairButton = Button(this).apply {
            text = getString(R.string.pair_button)
            setOnClickListener { startActivity(PairingActivity.intent(this@MainActivity, authorized = false)) }
        }
        column.addView(pairButton)
        todayButton = Button(this).apply {
            text = getString(R.string.today_title)
            setOnClickListener { startActivity(HomeActivity.intent(this@MainActivity)) }
        }
        column.addView(todayButton)
        report = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 12f
            setPadding(0, pad, 0, pad)
            setTextIsSelectable(true)
        }
        column.addView(report)
        column.addView(TextView(this).apply {
            text = getString(R.string.version_line, BuildConfigInfo.versionName(this@MainActivity))
            textSize = 13f
            alpha = 0.6f
            setPadding(0, pad, 0, pad)
            setOnClickListener { onVersionTapped() }
        })
        setContentView(ScrollView(this).apply { addView(column) })
    }

    private var bootWarningDialog: AlertDialog? = null

    override fun onResume() {
        super.onResume()
        taps = 0
        refresh()
        if (isDeviceOwner() && BootloaderWarning.needsAcknowledgement(this)) {
            if (bootWarningDialog?.isShowing != true) {
                bootWarningDialog = BootloaderWarning.confirm(this, ::applyOnOpen)
            }
            return
        }
        applyOnOpen()
    }

    private fun applyOnOpen() {
        // Self-healing: every time the app is opened the lock is re-applied,
        // unless a parent has lifted it for maintenance.
        val justProvisioned = intent?.action == DevicePolicyManager.ACTION_PROVISIONING_SUCCESSFUL
        if (isDeviceOwner() && !Lock.isInMaintenanceWindow(this)) {
            Lock.applyAsync(this, if (justProvisioned) "provisioning successful" else "app opened") {
                runOnUiThread {
                    refresh()
                    // Android 10 to 13: the phone app (and the call screening and redirection roles) can only be set with the system dialog.
                    if (askForRole()) return@runOnUiThread
                    // Straight after setup: pair with the parent's dashboard (once).
                    if (justProvisioned && PairingActivity.canPairWithoutPin(this)) {
                        intent = Intent(this, MainActivity::class.java)
                        startActivity(PairingActivity.intent(this, authorized = false))
                    }
                }
            }
        }
    }

    /**
     * Shows Android's role dialog ("set as default phone app", then call screening and call
     * redirection, #24) once per role and screen visit when Device Owner cannot set it silently
     * (before Android 14). Returns true if a dialog was opened.
     */
    private fun askForRole(): Boolean {
        // The lock is applied in the background; if the user left meanwhile, do not open a dialog over another app.
        if (!started || !isDeviceOwner()) return false
        val roles = getSystemService(RoleManager::class.java) ?: return false
        val controls = AndroidHardeningControls(this)
        val role = Hardening.nextRoleToRequest(
            android.os.Build.VERSION.SDK_INT,
            Lock.applier(this).needsDialerDialog() && roles.isRoleAvailable(RoleManager.ROLE_DIALER),
            controls::roleState,
            askedRoles,
        ) ?: return false
        askedRoles += role
        roleDialogOpen = runCatching {
            @Suppress("DEPRECATION") // A plain Activity without the AndroidX result API.
            startActivityForResult(roles.createRequestRoleIntent(role), REQUEST_ROLE)
        }.isSuccess
        return roleDialogOpen
    }

    override fun onStop() {
        super.onStop()
        started = false
        // Ask again the next time Plainphone is opened (the activity is singleTask and survives Home),
        // but not when it is our own dialog that covers the screen.
        if (!roleDialogOpen) askedRoles.clear()
    }

    @Deprecated("Plain Activity result callback.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        // onResume follows and re-applies the lock: with the role held the maker's phone apps get hidden.
        if (requestCode == REQUEST_ROLE) roleDialogOpen = false
        if (requestCode == REQUEST_ROLE) Log.i("Plainphone", "role dialog: ${if (resultCode == RESULT_OK) "accepted" else "declined"}")
    }

    private fun refresh() {
        val config = ConfigStore(this).load()
        status.text = buildString {
            appendLine(if (isDeviceOwner()) getString(R.string.status_owner) else getString(R.string.status_not_owner))
            if (Lock.isInMaintenanceWindow(this@MainActivity)) appendLine(getString(R.string.status_maintenance))
            appendLine(getString(R.string.status_dns, Lock.lockState(this@MainActivity).dnsHost ?: config.dnsHost))
            val sync = SyncStore(this@MainActivity)
            appendLine(
                when {
                    sync.released -> getString(R.string.status_sync_released)
                    sync.removed -> getString(R.string.status_sync_removed)
                    sync.isPaired -> sync.lastSyncAtMs
                        ?.let { getString(R.string.status_sync_ok, DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT).format(Date(it))) }
                        ?: getString(R.string.status_sync_never)
                    else -> getString(R.string.status_sync_unpaired)
                },
            )
            if (sync.isPaired && sync.rules() == null) appendLine(getString(R.string.status_sync_no_rules))
            val roles = getSystemService(RoleManager::class.java)
            appendLine(getString(if (roles?.isRoleHeld(RoleManager.ROLE_DIALER) == true) R.string.status_phone_role_ok else R.string.status_phone_role_missing))
            appendLine(getString(if (roles?.isRoleHeld(RoleManager.ROLE_SMS) == true) R.string.status_sms_role_ok else R.string.status_sms_role_missing))
            val contacts = ContactPolicySources.get(this@MainActivity).rules()
            appendLine(resources.getQuantityString(R.plurals.status_contacts, contacts.contacts.size, contacts.contacts.size))
            if (!contacts.enforced) appendLine(getString(R.string.status_contacts_not_enforced))
            val pending = LocalContactPolicySource(this@MainActivity).pending().size
            if (pending > 0) appendLine(resources.getQuantityString(R.plurals.status_contacts_pending, pending, pending))
            if (config.usesDefaultPin) appendLine(getString(R.string.status_default_pin))
            if (localBootWarning) appendLine(getString(R.string.setup_bootloader_warning))
            // #23: the server's verdict on the boot state; only shown when it is a warning.
            org.plainphone.app.sync.AttestationRunner.lastState(this@MainActivity)
                ?.takeIf { it != "verified" && it != "unverifiable" }
                ?.let { appendLine(getString(R.string.status_attestation_warning, it)) }
        }
        report.text = Lock.lastReport(this)
        pairButton.visibility = if (PairingActivity.canPairWithoutPin(this)) View.VISIBLE else View.GONE
        todayButton.visibility = if (HomeActivity.hasContent(this)) View.VISIBLE else View.GONE
        val safety = org.plainphone.app.safety.SafetyStore(this)
        sharingLine.text = when {
            !safety.sharingAlways -> getString(R.string.sharing_open)
            safety.alwaysUntilMs != null ->
                getString(R.string.location_always_badge_until, org.plainphone.app.safety.Safety.dateTime(this, safety.alwaysUntilMs!!))
            else -> getString(R.string.location_always_title)
        }
        sharingLine.setTypeface(null, if (safety.sharingAlways) Typeface.BOLD else Typeface.NORMAL)
    }

    private fun onVersionTapped() {
        taps++
        if (taps >= TAPS_TO_MAINTENANCE) {
            taps = 0
            startActivity(Intent(this, MaintenanceActivity::class.java))
        }
    }

    private fun isDeviceOwner() = getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(packageName)

    companion object {
        const val TAPS_TO_MAINTENANCE = 7
        private const val REQUEST_ROLE = 1
    }
}

internal object BuildConfigInfo {
    fun versionName(activity: Activity): String =
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "?"
}

