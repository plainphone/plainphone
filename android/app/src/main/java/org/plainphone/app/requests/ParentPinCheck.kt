// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.requests

import android.content.Context
import org.plainphone.app.ConfigStore
import org.plainphone.app.MaintenancePin
import org.plainphone.app.PinThrottle
import org.plainphone.app.PolicyConfig

/** The answer to a parent PIN typed on the phone. */
sealed interface PinResult {
    data object Correct : PinResult
    data object Wrong : PinResult
    /** Too many wrong tries: the next try is allowed after [seconds]. */
    data class Wait(val seconds: Int) : PinResult
    /** The phone only has the test PIN from setup, which a child could look up. It never approves anything. */
    data object NoPin : PinResult
}

/**
 * Checks the parent PIN the same way the maintenance screen does ([MaintenancePin] with the same rate
 * limit in [PinThrottle], so a wrong try here counts against the maintenance screen too). The PIN is
 * never logged and never leaves this function. Blocking: PBKDF2 takes a moment on a slow phone, so call
 * it off the main thread.
 */
object ParentPinCheck {
    fun check(entered: String, config: PolicyConfig, throttle: PinThrottle): PinResult {
        val waitSeconds = ((throttle.remainingMs() + 999) / 1000).toInt()
        if (waitSeconds > 0) return PinResult.Wait(waitSeconds)
        if (config.usesDefaultPin) return PinResult.NoPin
        val ok = MaintenancePin.verify(entered, config)
        if (ok) throttle.onSuccess() else throttle.onFailure()
        return if (ok) PinResult.Correct else PinResult.Wrong
    }

    fun check(context: Context, entered: String): PinResult =
        check(entered, ConfigStore(context).load(), PinThrottle.forContext(context))
}
