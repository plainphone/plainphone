// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.provisioning

import android.app.Activity
import android.app.AlertDialog
import android.content.Context
import java.util.concurrent.TimeUnit
import org.plainphone.app.R

/** Best-effort local warning. Only server attestation can establish trust in the boot state. */
internal object BootloaderWarning {
    private fun acknowledged(context: Context) =
        context.getSharedPreferences("plainphone_boot_warning", Context.MODE_PRIVATE)

    fun needsAcknowledgement(context: Context): Boolean =
        needsAcknowledgement(context, ::reportsUnlocked)

    internal fun needsAcknowledgement(context: Context, reportsUnlocked: () -> Boolean): Boolean =
        !acknowledged(context).getBoolean("acknowledged", false) && reportsUnlocked()

    fun acknowledge(context: Context) {
        acknowledged(context).edit().putBoolean("acknowledged", true).apply()
    }

    /** The background lock entry points wait until an activity has shown the warning. */
    fun confirm(activity: Activity, proceed: () -> Unit): AlertDialog? {
        if (!needsAcknowledgement(activity)) {
            proceed()
            return null
        }
        return AlertDialog.Builder(activity)
            .setMessage(R.string.setup_bootloader_warning)
            .setPositiveButton(android.R.string.ok) { _, _ ->
                acknowledge(activity)
                proceed()
            }
            .setNegativeButton(android.R.string.cancel, null)
            .show()
    }

    fun reportsUnlocked(): Boolean = unlocked

    private val unlocked: Boolean by lazy {
        runCatching {
            val process = ProcessBuilder("/system/bin/getprop", "ro.boot.verifiedbootstate").start()
            try {
                process.waitFor(250, TimeUnit.MILLISECONDS) &&
                    process.exitValue() == 0 &&
                    process.inputStream.bufferedReader().use { it.readLine()?.trim() } == "orange"
            } finally {
                process.destroy()
            }
        }.getOrDefault(false)
    }
}
