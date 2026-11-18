// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DeviceAdminReceiver
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.PersistableBundle
import org.plainphone.app.contacts.LocalContactPolicySource
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.provisioning.StrongSetup

/** The Device Policy Controller entry point that makes Plainphone Device Owner. */
class PlainphoneAdminReceiver : DeviceAdminReceiver() {

    override fun onProfileProvisioningComplete(context: Context, intent: Intent) {
        saveConfigFrom(context, intent)
        if (Build.VERSION.SDK_INT < 31 && StrongSetup.needsConfirmation(context)) {
            context.startActivity(Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        }
    }

    companion object {
        fun component(context: Context) = ComponentName(context, PlainphoneAdminReceiver::class.java)

        /** Stores the QR code's admin extras, if the intent carries them. */
        fun saveConfigFrom(context: Context, intent: Intent) {
            val extras = Compat.parcelableExtra<PersistableBundle>(intent, DevicePolicyManager.EXTRA_PROVISIONING_ADMIN_EXTRAS_BUNDLE) ?: return
            saveExtras(context, extras)
        }

        /** Stores the QR code's settings, and its enrollment token (sealed) for pairing after setup. */
        fun saveExtras(context: Context, extras: PersistableBundle) {
            val config = PolicyConfig.fromExtras(extras)
            ConfigStore(context).save(config)
            LocalContactPolicySource(context).seedIfEmpty(config.seedContacts)
            val sync = SyncStore(context)
            if (config.enrollToken != null && !sync.everPaired) {
                StrongSetup.requireAccount(context)
                sync.saveEnrollToken(config.enrollToken)
            }
        }
    }
}
