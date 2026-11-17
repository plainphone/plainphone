// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.app.admin.DeviceAdminReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import org.plainphone.app.R
import org.plainphone.app.sync.SyncScheduler

/**
 * Light mode's device admin. Its only job: Android will not uninstall an app while it is an active
 * device admin, so removing Plainphone takes one more step, which the guard blocks and the parent
 * hears about. It declares a single non-deprecated policy (force-lock), unlike the Device Owner
 * receiver, because Android refuses deprecated admin policies for ordinary apps on Android 10+.
 */
class LightAdminReceiver : DeviceAdminReceiver() {
    override fun onEnabled(context: Context, intent: Intent) {
        SyncScheduler.now(context, "device admin on")
    }

    override fun onDisableRequested(context: Context, intent: Intent): CharSequence =
        context.getString(R.string.light_admin_disable_warning)

    override fun onDisabled(context: Context, intent: Intent) {
        // The parent sees it with the status that this sync sends.
        SyncScheduler.now(context, "device admin off")
    }

    companion object {
        fun component(context: Context) = ComponentName(context, LightAdminReceiver::class.java)
    }
}
