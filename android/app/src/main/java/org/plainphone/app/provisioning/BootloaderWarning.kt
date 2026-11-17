// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.provisioning

import java.util.concurrent.TimeUnit

/** Best-effort local warning. Only server attestation can establish trust in the boot state. */
internal object BootloaderWarning {
    fun reportsUnlocked(): Boolean = runCatching {
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
