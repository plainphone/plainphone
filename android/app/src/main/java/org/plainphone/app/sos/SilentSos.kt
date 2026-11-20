// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.SystemClock
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SosRules
import org.plainphone.app.sync.SyncStore

/**
 * What "What can my parents see?" tells the child about the hidden SOS (principle 1): which hidden
 * ways are on, and which quick messages are code words. Empty when none are.
 */
data class SosSharing(
    /** The number of power button presses, or null when that way is off. */
    val powerPresses: Int? = null,
    val clock: Boolean = false,
    val codeWords: List<String> = emptyList(),
    /** The SOS can carry a position, so the child is told it does. */
    val withPosition: Boolean = false,
) {
    companion object {
        val NONE = SosSharing()

        fun from(rules: ServerRules?): SosSharing {
            val r = rules ?: return NONE
            val sos = SilentSos.childSos(r) ?: return NONE
            return SosSharing(
                powerPresses = sos.hidden.presses.takeIf { sos.hidden.power },
                clock = sos.hidden.clock,
                codeWords = sos.quickMessages.codeWords,
                withPosition = r.locationEnabled && r.locationMode != ServerRules.LOCATION_OFF,
            )
        }
    }
}

/**
 * The silent urgent SOS (docs/sos.md): the power button pressed quickly, the home screen clock held,
 * or a quick message that is a code word. It sends the alert with a position like the SOS screen does,
 * but never calls, never shows anything and never makes a sound. The only confirmation, if the
 * parents chose it, is one short vibration. 112 is not touched.
 */
@android.annotation.SuppressLint("StaticFieldLeak") // Holds the application context only.
object SilentSos {
    private const val TAG = "Plainphone"
    private const val VIBRATION_MS = 60L

    /** The SOS rules when this phone is a child phone that has not been released. */
    internal fun childSos(rules: ServerRules?): SosRules? =
        rules?.sos?.takeIf { rules.profile == "child" && !rules.release }

    /** Sends a silent SOS. False when the phone is not a paired child phone. */
    fun send(context: Context, trigger: String, message: String? = null): Boolean {
        val sync = SyncStore(context)
        val phoneId = sync.phoneId ?: return false
        childSos(sync.rules()) ?: return false
        return runCatching { SosDelivery.enqueue(context, phoneId, SosKind.URGENT, trigger, message) }
            .onFailure { Log.e(TAG, "silent SOS could not be queued", it) }
            .isSuccess
    }

    /** The clock on the home screen was held. Does nothing when the parents have not switched it on. */
    fun clockHeld(context: Context) {
        val sos = childSos(SyncStore(context).rules()) ?: return
        if (!sos.hidden.clock) return
        if (send(context, "clock")) confirm(context, sos)
    }

    /** One short vibration when the parents chose it; nothing otherwise. */
    private fun confirm(context: Context, sos: SosRules) {
        if (!sos.hidden.vibrate) return
        runCatching {
            val vibrator = if (android.os.Build.VERSION.SDK_INT >= 31) {
                context.getSystemService(VibratorManager::class.java)?.defaultVibrator
            } else {
                @Suppress("DEPRECATION") context.getSystemService(Vibrator::class.java)
            } ?: return
            val effect = VibrationEffect.createOneShot(VIBRATION_MS, VibrationEffect.DEFAULT_AMPLITUDE)
            if (android.os.Build.VERSION.SDK_INT >= 33) {
                vibrator.vibrate(effect, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_TOUCH))
            } else {
                vibrator.vibrate(effect)
            }
        }.onFailure { Log.w(TAG, "could not vibrate", it) }
    }

    private val counter = PowerPressCounter()
    private var registered = false

    /**
     * Watches the power button for as long as the process lives: in strong mode Plainphone is the home
     * screen and device owner, in light mode its accessibility service keeps it running. Screen on and
     * off can only be received by a receiver registered at runtime, so this is called from the
     * application's start. Only counts when the parents switched the power button on.
     */
    fun watchPowerButton(context: Context) {
        val app = context.applicationContext
        synchronized(this) {
            if (registered) return
            registered = true
        }
        app.registerReceiver(
            object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    val sos = childSos(SyncStore(context).rules())
                    if (sos == null || !sos.hidden.power) {
                        counter.reset()
                        return
                    }
                    if (counter.press(SystemClock.elapsedRealtime(), sos.hidden.presses) && send(context, "power")) {
                        confirm(context, sos)
                    }
                }
            },
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            },
        )
    }
}
