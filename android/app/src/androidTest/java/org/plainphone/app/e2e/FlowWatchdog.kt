// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.e2e

import android.os.Looper
import android.util.Log
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement

/**
 * Fails a flow that is still running after [limitSeconds], before the harness's own limit ends
 * `am instrument` without a word (run 45036374085: "su did not finish within 420 s"). Every wait in
 * a flow has its own deadline, so only a call that never returns gets here: a shell command, a
 * main-thread task or a lock. The failure names the last [step] and shows where the flow and the
 * app's main thread are stuck; logcat gets every thread. It never retries or skips anything.
 */
class FlowWatchdog(private val limitSeconds: Long?) : TestRule {
    @Volatile var step = "start"
        private set

    fun step(name: String) {
        step = name
        Log.i(TAG, "step: $name")
    }

    override fun apply(base: Statement, description: Description): Statement {
        val limit = limitSeconds ?: return base
        return object : Statement() {
            override fun evaluate() {
                var failure: Throwable? = null
                val flow = Thread({
                    try {
                        base.evaluate()
                    } catch (t: Throwable) {
                        failure = t
                    }
                }, "emulator-flow")
                flow.start()
                flow.join(limit * 1000)
                if (flow.isAlive) {
                    val stuck = flow.stackTrace
                    val main = Looper.getMainLooper().thread.stackTrace
                    for ((thread, frames) in Thread.getAllStackTraces()) {
                        // Logcat cuts an entry at about 4 KB; the deepest frames of a stuck call matter most.
                        frames.toList().chunked(LOG_FRAMES).forEachIndexed { part, chunk ->
                            Log.e(TAG, "watchdog: ${thread.name} (${thread.state}) part ${part + 1}\n${chunk.joinToString("\n") { "  at $it" }}")
                        }
                    }
                    flow.interrupt()
                    throw AssertionError(
                        "${description.methodName} still running after $limit s, at step \"$step\".\n" +
                            "Flow thread:\n${frames(stuck)}\nMain thread:\n${frames(main)}",
                    )
                }
                failure?.let { throw it }
            }
        }
    }

    private fun frames(trace: Array<StackTraceElement>) = trace.take(MAX_FRAMES).joinToString("\n") { "  at $it" }

    private companion object {
        const val TAG = "PlainphoneE2E"
        const val MAX_FRAMES = 40
        const val LOG_FRAMES = 20
    }
}
