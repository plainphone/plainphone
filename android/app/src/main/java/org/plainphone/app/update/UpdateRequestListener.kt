// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.Context
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.plainphone.app.ConfigStore
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore

/** Delivers dashboard requests while the phone process is running. Rules sync is the fallback. */
object UpdateRequestListener {
    private val running = AtomicBoolean()
    private val executor = Executors.newSingleThreadExecutor()

    fun start(context: Context) {
        if (!running.compareAndSet(false, true)) return
        val app = context.applicationContext
        executor.execute {
            try {
                val pairing = SyncStore(app)
                val state = PrefsUpdateStateStore(app)
                val api = PlainphoneApi(ConfigStore(app).load().serverUrl)
                while (!pairing.removed) {
                    val token = pairing.deviceToken() ?: break
                    val requested = api.waitForUpdateRequest(token, state.handledRequestMs) ?: continue
                    if (pairing.removed || pairing.deviceToken() != token) break
                    SelfUpdate.request(app, requested)
                }
            } catch (e: Exception) {
                // Older servers and offline phones keep working through the existing sync schedule.
                Log.d("Plainphone", "update request listener stopped", e)
            } finally {
                running.set(false)
            }
        }
    }
}
