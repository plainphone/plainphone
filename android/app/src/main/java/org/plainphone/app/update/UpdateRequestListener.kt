// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.CancellationSignal
import android.os.PowerManager
import android.util.Log
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executor
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.plainphone.app.ConfigStore
import org.plainphone.app.distribution.Distribution
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore

/** Delivers dashboard requests while interactive. Push and rules sync also work when asleep. */
object UpdateRequestListener {
    private const val INITIAL_RETRY_MS = 1_000L
    private const val MAX_RETRY_MS = 60_000L
    private val executor = Executors.newSingleThreadExecutor()
    private var listener: InteractiveUpdatePoll? = null

    internal fun shouldRetryHttpStatus(status: Int): Boolean =
        status == 408 || status == 409 || status == 429 || (status in 500..599 && status != 501)

    @Synchronized
    fun start(context: Context) {
        if (!Distribution.SELF_UPDATES) return
        val app = context.applicationContext
        val current = listener ?: register(app).also { listener = it }
        current.wake()
    }

    private fun register(app: Context): InteractiveUpdatePoll {
        val power = app.getSystemService(PowerManager::class.java)!!
        val poll = InteractiveUpdatePoll({ power.isInteractive }, executor) { session ->
            listen(app, session)
        }
        app.registerReceiver(object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                when (intent.action) {
                    Intent.ACTION_SCREEN_OFF -> poll.sleep()
                    Intent.ACTION_SCREEN_ON, Intent.ACTION_USER_PRESENT -> poll.wake()
                }
            }
        }, IntentFilter().apply {
            addAction(Intent.ACTION_SCREEN_OFF)
            addAction(Intent.ACTION_SCREEN_ON)
            addAction(Intent.ACTION_USER_PRESENT)
        })
        return poll
    }

    private fun listen(app: Context, session: InteractiveUpdatePoll.Session) {
        val pairing = SyncStore(app)
        val state = PrefsUpdateStateStore(app)
        var retryMs = INITIAL_RETRY_MS
        while (session.canPoll() && !pairing.removed) {
            val token = pairing.deviceToken() ?: return
            try {
                val api = PlainphoneApi(ConfigStore(app).load().serverUrl, app)
                if (!session.canPoll()) return
                val requested = api.waitForUpdateRequest(token, state.handledRequestMs, session.cancellation)
                if (requested != null && session.canPoll() && !pairing.removed && pairing.deviceToken() == token) {
                    SelfUpdate.request(app, requested)
                }
                retryMs = INITIAL_RETRY_MS
            } catch (e: InterruptedException) {
                Thread.currentThread().interrupt()
                return
            } catch (e: Exception) {
                if (!session.canPoll()) return
                if (e is HttpError && !shouldRetryHttpStatus(e.status)) {
                    Log.d("Plainphone", "update request listener stopped; using rules sync", e)
                    return
                }
                Log.d("Plainphone", "retrying update request listener in ${retryMs}ms", e)
                if (!session.waitToRetry(retryMs)) return
                retryMs = (retryMs * 2).coerceAtMost(MAX_RETRY_MS)
            }
        }
    }
}

internal class InteractiveUpdatePoll(
    private val interactive: () -> Boolean,
    private val executor: Executor,
    private val listen: (Session) -> Unit,
) {
    private var active: Session? = null
    private var awake = false

    @Synchronized
    fun wake() {
        awake = interactive()
        if (active != null || !awake) return
        val session = Session(interactive)
        active = session
        executor.execute {
            try {
                if (session.canPoll()) listen(session)
            } finally {
                synchronized(this) {
                    active = null
                    // Screen-on may have arrived while the canceled request was unwinding.
                    if (session.cancellation.isCanceled && awake) wake()
                }
            }
        }
    }

    @Synchronized
    fun sleep() {
        awake = false
        active?.cancel()
    }

    class Session(private val interactive: () -> Boolean) {
        val cancellation = CancellationSignal()
        private val stopped = CountDownLatch(1)

        fun canPoll() = !cancellation.isCanceled && interactive()

        fun cancel() {
            cancellation.cancel()
            stopped.countDown()
        }

        fun waitToRetry(delayMs: Long): Boolean = try {
            !stopped.await(delayMs, TimeUnit.MILLISECONDS)
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            false
        }
    }
}
