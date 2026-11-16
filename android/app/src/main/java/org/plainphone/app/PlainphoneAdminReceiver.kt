// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.PersistableBundle

/** The Device Policy Controller entry point that makes Plainphone Device Owner. */
class PlainphoneAdminReceiver : DeviceAdminReceiver() {

    /** Fires when the app becomes admin, also via `adb shell dpm set-device-owner` on a test phone. */
    override fun onEnabled(context: Context, intent: Intent) {
        if (context.getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(context.packageName)) {
            Lock.applyAsync(context, "admin enabled")
        }
    }

    /** Older provisioning path; on Android 12+ PolicyComplianceActivity runs first. Applying twice is harmless. */
    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        saveConfigFrom(context, intent)
        Lock.applyAsync(context, "provisioning complete")
    }

    companion object {
        fun component(context: Context) = ComponentName(context, PlainphoneAdminReceiver::class.java)

        /** Stores the QR code's admin extras, if the intent carries them. */
        fun saveConfigFrom(context: Context, intent: Intent) {
            val extras = intent.getParcelableExtra(
                DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE,
                PersistableBundle::class.java,
            ) ?: return
            ConfigStore(context).save(PolicyConfig.fromExtras(extras))
        }
    }
}
