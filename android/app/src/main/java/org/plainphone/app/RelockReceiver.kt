// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Puts the lock back after a reboot, an app update or the end of a maintenance unlock. */
class RelockReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, ACTION_RELOCK -> {
                val pending = goAsync()
                Lock.applyAsync(context, intent.action ?: "relock") { pending.finish() }
            }
        }
    }

    companion object {
        const val ACTION_RELOCK = "org.plainphone.app.RELOCK"
    }
}
