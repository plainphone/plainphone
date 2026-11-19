// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.provisioning

import android.app.Activity
import android.app.AlertDialog
import android.app.role.RoleManager
import android.content.Intent
import android.os.Build
import android.os.Bundle
import org.plainphone.app.AndroidHardeningControls
import org.plainphone.app.Hardening
import org.plainphone.app.Lock
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.R
import org.plainphone.app.update.UpdateBatteryExemption

/**
 * Android 12+ provisioning hands over to the DPC before setup finishes.
 * We set every policy here, so the phone is locked before the user ever
 * reaches the home screen, then return RESULT_OK.
 */
class PolicyComplianceActivity : Activity() {
    private var batterySettingsOpen = false
    private val askedRoles = mutableSetOf<String>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PlainphoneAdminReceiver.saveConfigFrom(this, intent)
        batterySettingsOpen = savedInstanceState?.getBoolean("batterySettingsOpen") == true
        if (!batterySettingsOpen) applyForProvisioning()
    }

    private fun applyForProvisioning() {
        Lock.applyAsync(this, "provisioning (policy compliance)") {
            runOnUiThread { if (!isDestroyed && !isFinishing && !askForCallRole()) finishSetup() }
        }
    }

    /**
     * Android 12 and 13: Device Owner cannot set the phone app, so Android's call role dialogs are shown here,
     * while the parent is still in setup. Returns true if the dialog was opened.
     */
    private fun askForCallRole(): Boolean {
        val roles = getSystemService(RoleManager::class.java) ?: return false
        val role = Hardening.nextRoleToRequest(
            Build.VERSION.SDK_INT,
            Lock.applier(this).needsDialerDialog() && roles.isRoleAvailable(RoleManager.ROLE_DIALER),
            AndroidHardeningControls(this)::roleState,
            askedRoles,
        ) ?: return false
        askedRoles += role
        return runCatching {
            @Suppress("DEPRECATION") // A plain Activity without the AndroidX result API.
            startActivityForResult(roles.createRequestRoleIntent(role), REQUEST_ROLE)
        }.isSuccess
    }

    @Deprecated("Plain Activity result callback.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        when (requestCode) {
            REQUEST_ROLE -> if (!askForCallRole()) {
                Lock.applyAsync(this, "call role dialogs") { runOnUiThread { finishSetup() } }
            }
            REQUEST_BATTERY -> {
                batterySettingsOpen = false
                Lock.applyAsync(this, "battery exemption dialog") { runOnUiThread { done() } }
            }
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putBoolean("batterySettingsOpen", batterySettingsOpen)
    }

    private fun finishSetup() {
        if (isDestroyed || isFinishing) return
        val request = UpdateBatteryExemption.setupRequest(this) ?: return done()
        AlertDialog.Builder(this)
            .setTitle(R.string.update_battery_required)
            .setMessage(R.string.update_battery_reason)
            .setPositiveButton(R.string.update_battery_continue) { _, _ ->
                batterySettingsOpen = runCatching {
                    @Suppress("DEPRECATION")
                    startActivityForResult(request, REQUEST_BATTERY)
                }.isSuccess
            }
            .setNegativeButton(android.R.string.cancel, null)
            .setOnDismissListener { if (!batterySettingsOpen) done() }
            .show()
    }

    private fun done() {
        setResult(RESULT_OK)
        finish()
    }

    private companion object {
        const val REQUEST_ROLE = 1
        const val REQUEST_BATTERY = 2
    }
}
