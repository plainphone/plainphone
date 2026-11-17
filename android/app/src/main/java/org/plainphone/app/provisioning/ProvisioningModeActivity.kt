// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.provisioning

import android.app.Activity
import android.app.AlertDialog
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle
import android.os.PersistableBundle
import org.plainphone.app.Compat
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.R

/**
 * Android 12+ QR provisioning asks the DPC which mode it wants.
 * Plainphone only supports a fully managed device (Device Owner).
 */
class ProvisioningModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The extra exists from Android 12; on Android 10 and 11 it is absent and the result is fully managed.
        val allowed = intent.getIntArrayExtra(ALLOWED_MODES)
        val fullyManaged = DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
        if (allowed != null && fullyManaged !in allowed) {
            // Personal-device flows (work profile) are not supported: abort provisioning.
            setResult(RESULT_CANCELED)
            finish()
        } else if (BootloaderWarning.reportsUnlocked()) {
            AlertDialog.Builder(this)
                .setMessage(R.string.setup_bootloader_warning)
                .setPositiveButton(R.string.setup_bootloader_continue) { _, _ -> accept(fullyManaged) }
                .setNegativeButton(android.R.string.cancel) { _, _ -> finish() }
                .setOnCancelListener { finish() }
                .show()
        } else {
            accept(fullyManaged)
        }
    }

    private fun accept(mode: Int) {
        Compat.parcelableExtra<PersistableBundle>(intent, DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE)
            ?.let { PlainphoneAdminReceiver.saveExtras(this, it) }

        setResult(RESULT_OK, Intent().putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, mode))
        finish()
    }

    private companion object {
        /** DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES (API 31), as its string value. */
        const val ALLOWED_MODES = "android.app.extra.PROVISIONING_ALLOWED_PROVISIONING_MODES"
    }
}
