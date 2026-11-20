// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.Context
import android.os.Build
import android.os.UserManager
import android.util.Log
import org.plainphone.app.AndroidDeviceControls

/**
 * Android 10 has no `setUserControlDisabledPackages`, so Settings offers Force stop for Plainphone.
 * A Force stop cancels the watchdog and its alarms, and a lifted install or account restriction
 * would stay lifted until Plainphone starts again. While any install lease is open (or still needs
 * recovery), Plainphone sets `DISALLOW_APPS_CONTROL`, which greys out Force stop and Clear data for
 * every app. Android keeps a user restriction across process death, so nothing has to run for the
 * guard to hold. It is cleared once the lease is closed and the restrictions are back
 * (docs/policies.md, "Force stop during an install window").
 */
internal object ForceStopGuard {
    const val RESTRICTION = UserManager.DISALLOW_APPS_CONTROL

    /** Android 11+ greys out Force stop for Plainphone permanently (Hardening.NO_FORCE_STOP). */
    fun needed(sdkInt: Int) = sdkInt < 30

    /** Sets or clears the guard. Never throws: a failed guard must not stop an install or a relock. */
    fun update(context: Context, on: Boolean, sdkInt: Int = Build.VERSION.SDK_INT) {
        if (!needed(sdkInt)) return
        val device = AndroidDeviceControls(context.applicationContext)
        runCatching {
            if (!device.isDeviceOwner()) return
            if (on) device.addRestriction(RESTRICTION) else device.clearRestriction(RESTRICTION)
        }.onFailure { Log.w("Plainphone", "Could not ${if (on) "set" else "clear"} the force stop guard", it) }
    }
}
