// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Assert.assertThrows
import org.junit.Test

class WakeupInventoryTest {
    private val calls = Regex(
        """(?:\b(?:set(?:Exact)?AndAllowWhileIdle|setExact|setRepeating|setInexactRepeating|setAlarmClock|setWindow|""" +
            """(?:OneTime|Periodic)WorkRequestBuilder|(?:OneTime|Periodic)WorkRequest\.Builder|enqueueUnique\w*|registerReceiver|postDelayed|""" +
            """postAtTime|postAtFrontOfQueue|sendMessageDelayed|sendMessageAtTime|sendEmptyMessageDelayed|startForegroundService|""" +
            """scheduleAtFixedRate|scheduleWithFixedDelay|newScheduledThreadPool|newSingleThreadScheduledExecutor|fixedRateTimer|Timer|CountDownTimer|""" +
            """newWakeLock|register(?:Default)?NetworkCallback|requestLocationUpdates|requestSingleUpdate|getCurrentLocation|set|acquire|enqueue))\s*[<(]""" +
            // schedule is a common name; only these receivers are wakeups (own helpers end in enqueueUnique*).
            """|\b(?:[Jj]obScheduler|[Ee]xecutor\w*|[Tt]imer)\??\.schedule\s*\("""
    )

    private val setter = Regex("""^set\(\w+\)\s*[{=]""")

    @Test
    fun `all wakeup call sites are documented`() {
        val source = File("src/main")
        val app = File(source, "java/org/plainphone/app")
        val actual = source.walkTopDown()
            .filter { it.isFile && it.extension in setOf("kt", "java") }
            .flatMap { file -> callSites(file.relativeTo(app).invariantSeparatorsPath, file.readText()) }
            .toList()
        val row = Regex("""^\| `([^`]+)` `([^`]+)` \|""")
        val documented = File("../../docs/wakeups.md").readLines().mapNotNull { line ->
            row.find(line)?.let { it.groupValues[1] to it.groupValues[2] }
        }
        assertThat(actual).isNotEmpty()
        checkInventory(actual, documented)
    }

    @Test
    fun `new wakeup call sites fail the inventory check`() {
        val known = "Fixture.kt" to "handler.postDelayed(task, delay)"
        val undocumented = listOf(
            "WorkManager.getInstance(context)\n    .enqueue(request)",
            "OneTimeWorkRequestBuilder<Worker>()",
            "power.newWakeLock(flags, tag)", "lock.acquire(timeout)",
            "manager.registerDefaultNetworkCallback(callback)", "manager.registerNetworkCallback(request, callback)",
            "location.requestLocationUpdates(provider, listener)", "location.getCurrentLocation(provider, listener)",
            "with(alarms) { set(type, time, intent) }", "manager.run { enqueue(request) }",
            "alarm.set(type, time, intent)", "alarm.setExact(type, time, intent)",
            "alarm.setRepeating(type, time, interval, intent)", "alarm.setInexactRepeating(type, time, interval, intent)",
            "alarm.setAlarmClock(info, intent)", "alarm.setWindow(type, time, window, intent)",
            "OneTimeWorkRequest.Builder(Worker::class.java)", "PeriodicWorkRequest.Builder(Worker::class.java, 15, MINUTES)",
            "jobScheduler.schedule(info)", "handler.postAtTime(task, uptime)", "handler.sendMessageDelayed(message, delay)",
            "executor.scheduleAtFixedRate(task, 0, 1, SECONDS)", "scheduler.scheduleWithFixedDelay(task, 0, 1, SECONDS)",
            "Executors.newScheduledThreadPool(1)", "executor.schedule(task, 5, SECONDS)", "Timer().schedule(task, 100)",
            "context.startForegroundService(intent)", "object : CountDownTimer(1000, 100) {}",
            "alarm.set(type, time, intent) // trailing comment", "val url = \"http://x\"; alarm.set(type, time, intent)",
            "set(v) { alarm.set(type, time, intent) }", "/* note */ alarm.set(type, time, intent)",
        )
        for (call in undocumented) {
            val error = assertThrows(AssertionError::class.java) {
                checkInventory(callSites(known.first, "${known.second}\n$call").toList(), listOf(known))
            }
            assertThat(error.message).contains(call.lineSequence().last().trim())
        }
    }

    @Test
    fun `comments and setter declarations are not wakeup call sites`() {
        val ignored = listOf(
            "// alarm.set(type, time, intent)",
            "/* alarm.set(type, time, intent) */",
            "/**\n * Calls alarm.set(type, time, intent) later.\n */",
            "    var level: Int\n        set(v) { field = v }",
            "    set(value) = save(value)",
            "fun set(type: Int) {}",
        )
        for (source in ignored) assertThat(callSites("Fixture.kt", source).toList()).isEmpty()
    }

    private fun checkInventory(actual: List<Pair<String, String>>, documented: List<Pair<String, String>>) {
        assertThat(actual).containsExactlyElementsIn(documented)
    }

    /** Replaces comments with spaces (offsets and line breaks stay), leaving string contents alone. */
    private fun blankComments(source: String): String {
        val out = StringBuilder(source)
        var i = 0
        fun blank(from: Int, to: Int) { for (k in from until to) if (out[k] != '\n') out[k] = ' ' }
        while (i < source.length) {
            when {
                source.startsWith("//", i) -> {
                    val end = source.indexOf('\n', i).takeIf { it >= 0 } ?: source.length
                    blank(i, end)
                    i = end
                }
                source.startsWith("/*", i) -> {
                    val end = source.indexOf("*/", i + 2).let { if (it < 0) source.length else it + 2 }
                    blank(i, end)
                    i = end
                }
                source.startsWith("\"\"\"", i) -> {
                    i = source.indexOf("\"\"\"", i + 3).let { if (it < 0) source.length else it + 3 }
                }
                source[i] == '"' || source[i] == '\'' -> {
                    val quote = source[i]
                    i++
                    while (i < source.length && source[i] != quote && source[i] != '\n') i += if (source[i] == '\\') 2 else 1
                    i++
                }
                else -> i++
            }
        }
        return out.toString()
    }

    private fun callSites(path: String, contents: String): Sequence<Pair<String, String>> {
        val code = blankComments(contents)
        return calls.findAll(code).mapNotNull { match ->
            val lineStart = contents.lastIndexOf('\n', match.range.first - 1) + 1
            val lineEnd = contents.indexOf('\n', match.range.first).takeIf { it >= 0 } ?: contents.length
            val line = contents.substring(lineStart, lineEnd).trim()
            val prefix = code.substring(lineStart, match.range.first).trim()
            // A setter declaration starts at its own `set(v)`, not at a call later on the same line.
            val declaration = prefix.isEmpty() && setter.containsMatchIn(code.substring(match.range.first, lineEnd))
            if (declaration || prefix.substringAfterLast(' ') == "fun") return@mapNotNull null
            if (path == "settings/SettingsApplier.kt" && line == "set()") return@mapNotNull null
            // AlarmManager.set has a generic name. These two calls write a QR bit array.
            if (path == "ui/qr/BitBuffer.java" && line in setOf(
                    "data.set(bitLength, QrCode.getBit(val, i));",
                    "data.set(bitLength, bb.data.get(i));",
                )
            ) null else path to line
        }
    }
}
