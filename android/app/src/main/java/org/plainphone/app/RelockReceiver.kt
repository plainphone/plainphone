// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.sync.SyncScheduler

/**
 * Puts the lock back after a reboot, an app update or the end of a maintenance unlock, and
 * switches school time and bedtime on and off. Boot and updates also start a sync.
 */
class RelockReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, ACTION_RELOCK -> {
                val pending = goAsync()
                val reason = intent.action ?: "relock"
                if (intent.action != ACTION_RELOCK) {
                    Lock.recoverInstallAsync(context, reason)
                    SyncScheduler.onBoot(context)
                }
                Lock.applyAsync(context, reason) { pending.finish() }
            }
            ACTION_INSTALL_DONE -> InstallWindow.close(context, "install window ended")
            ACTION_WINDOW -> {
                val pending = goAsync()
                Lock.applyIfNeededAsync(context, "school time or bedtime starts or ends") { pending.finish() }
            }
        }
    }

    companion object {
        const val ACTION_RELOCK = "org.plainphone.app.RELOCK"
        const val ACTION_WINDOW = "org.plainphone.app.WINDOW"
        const val ACTION_INSTALL_DONE = "org.plainphone.app.INSTALL_DONE"
    }
}
