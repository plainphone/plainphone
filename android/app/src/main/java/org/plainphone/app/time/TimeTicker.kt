// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import org.plainphone.app.Lock
import org.plainphone.app.light.Mode
import org.plainphone.app.sync.SyncStore

/**
 * Strong mode: while the screen is on, look at the time limits every minute and suspend an app as
 * soon as its time is used up (applyIfNeeded only re-applies when the used-up set changed). Light
 * mode's guard does the same from the accessibility service. With the screen off nothing is used,
 * so nothing ticks. If Android stopped Plainphone, the 15-minute sync catches up.
 */
object TimeTicker {
    private const val EVERY_MS = 60_000L
    private val main = Handler(Looper.getMainLooper())
    private var app: Context? = null

    private val tick = object : Runnable {
        override fun run() {
            val context = app ?: return
            if (Mode.isStrong(context) && SyncStore(context).rules()?.timeLimits?.isEmpty == false) {
                Lock.applyIfNeededAsync(context, "time limits") {}
            }
            main.postDelayed(this, EVERY_MS)
        }
    }

    fun register(context: Context) {
        app = context.applicationContext
        context.registerReceiver(
            object : BroadcastReceiver() {
                override fun onReceive(context: Context, intent: Intent) {
                    main.removeCallbacks(tick)
                    if (intent.action == Intent.ACTION_SCREEN_ON) main.postDelayed(tick, EVERY_MS)
                }
            },
            IntentFilter().apply {
                addAction(Intent.ACTION_SCREEN_ON)
                addAction(Intent.ACTION_SCREEN_OFF)
            },
        )
        main.postDelayed(tick, EVERY_MS)
    }
}
