// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.Context
import android.util.Log
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import org.plainphone.app.ConfigStore
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore

/** Delivers dashboard requests while the phone process is running. Rules sync is the fallback. */
object UpdateRequestListener {
    private const val INITIAL_RETRY_MS = 1_000L
    private const val MAX_RETRY_MS = 60_000L

    internal fun shouldRetryHttpStatus(status: Int): Boolean =
        status == 408 || status == 429 || (status in 500..599 && status != 501)

    private val running = AtomicBoolean()
    private val executor = Executors.newSingleThreadExecutor()

    fun start(context: Context) {
        if (!running.compareAndSet(false, true)) return
        val app = context.applicationContext
        executor.execute {
            try {
                val pairing = SyncStore(app)
                val state = PrefsUpdateStateStore(app)
                var retryMs = INITIAL_RETRY_MS
                while (!pairing.removed) {
                    val token = pairing.deviceToken() ?: break
                    try {
                        val api = PlainphoneApi(ConfigStore(app).load().serverUrl)
                        val requested = api.waitForUpdateRequest(token, state.handledRequestMs)
                        if (requested != null && !pairing.removed && pairing.deviceToken() == token) {
                            SelfUpdate.request(app, requested)
                        }
                        retryMs = INITIAL_RETRY_MS
                    } catch (e: InterruptedException) {
                        throw e
                    } catch (e: Exception) {
                        if (e is HttpError && !shouldRetryHttpStatus(e.status)) {
                            Log.d("Plainphone", "update request listener stopped; using rules sync", e)
                            break
                        }
                        Log.d("Plainphone", "retrying update request listener in ${retryMs}ms", e)
                        Thread.sleep(retryMs)
                        retryMs = (retryMs * 2).coerceAtMost(MAX_RETRY_MS)
                    }
                }
            } catch (_: InterruptedException) {
                Thread.currentThread().interrupt()
            } finally {
                running.set(false)
            }
        }
    }
}
