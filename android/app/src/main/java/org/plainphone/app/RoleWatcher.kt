// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.telecom.TelecomManager
import android.util.Log
import java.util.concurrent.Executors
import org.plainphone.app.sync.SyncScheduler

/**
 * #24: when the default phone app changes (possible in Settings on Android 10 to 13), re-check the
 * lock at once and tell the server, instead of waiting for the 15-minute check. The failed
 * "default phone app" step then shows up in the parent's dashboard within a minute, and
 * Plainphone asks for the role again when it is opened.
 *
 * Registered at runtime from [PlainphoneApplication]: the broadcast is implicit and does not reach
 * manifest receivers. Plainphone normally runs (it is the SMS app), so that is enough.
 */
object RoleWatcher {
    private val executor = Executors.newSingleThreadExecutor()

    /** The broadcast is exported, so any app can send it: one apply and sync per 30 s, the last call kept. */
    const val DEBOUNCE_MS = 30_000L

    private fun applyAndSync(app: Context) {
        try {
            // maxAgeMs = 0: always re-apply now; skipped during a maintenance unlock.
            Lock.applyIfNeeded(app, "default phone app changed", maxAgeMs = 0L)
            SyncScheduler.now(app, "default phone app changed")
        } catch (e: Exception) {
            Log.e("Plainphone", "re-check after phone app change failed", e)
        }
    }

    fun register(context: Context) {
        val app = context.applicationContext
        val handler = Handler(Looper.getMainLooper())
        val debounce = Debounce(
            DEBOUNCE_MS, SystemClock::elapsedRealtime,
            schedule = { delay, task -> handler.postDelayed({ executor.execute(task) }, delay) },
            action = { applyAndSync(app) },
        )
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                val pending = goAsync()
                executor.execute {
                    try {
                        debounce.trigger()
                    } finally {
                        pending.finish()
                    }
                }
            }
        }
        val filter = IntentFilter(TelecomManager.ACTION_DEFAULT_DIALER_CHANGED)
        // Sent by Telecom, another process: the receiver has to be exported.
        if (Build.VERSION.SDK_INT >= 33) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_EXPORTED)
        } else {
            context.registerReceiver(receiver, filter)
        }
    }
}
