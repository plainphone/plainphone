// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.provisioning

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.os.Bundle
import android.os.PersistableBundle
import org.plainphone.app.ConfigStore
import org.plainphone.app.PolicyConfig

/**
 * Android 12+ QR provisioning asks the DPC which mode it wants.
 * Plainphone only supports a fully managed device (Device Owner).
 */
class ProvisioningModeActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        intent.getParcelableExtra(
            DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
            PersistableBundle::class.java,
        )?.let { ConfigStore(this).save(PolicyConfig.fromExtras(it)) }

        val allowed = intent.getIntArrayExtra(DevicePolicyManager.EXTRA_PROVISIONING_ALLOWED_PROVISIONING_MODES)
        val fullyManaged = DevicePolicyManager.PROVISIONING_MODE_FULLY_MANAGED_DEVICE
        if (allowed != null && fullyManaged !in allowed) {
            // Personal-device flows (work profile) are not supported: abort provisioning.
            setResult(RESULT_CANCELED)
        } else {
            setResult(
                RESULT_OK,
                Intent().putExtra(DevicePolicyManager.EXTRA_PROVISIONING_MODE, fullyManaged),
            )
        }
        finish()
    }
}
