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
            """(?:OneTime|Periodic)WorkRequestBuilder|enqueueUnique\w*|registerReceiver|postDelayed|""" +
            """newWakeLock|register(?:Default)?NetworkCallback|requestLocationUpdates|requestSingleUpdate|getCurrentLocation)|""" +
            """\.\s*(?:set|acquire|enqueue))\s*[<(]"""
    )

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
            "alarm.set(type, time, intent)", "alarm.setExact(type, time, intent)",
            "alarm.setRepeating(type, time, interval, intent)", "alarm.setInexactRepeating(type, time, interval, intent)",
            "alarm.setAlarmClock(info, intent)", "alarm.setWindow(type, time, window, intent)",
        )
        for (call in undocumented) {
            val error = assertThrows(AssertionError::class.java) {
                checkInventory(callSites(known.first, "${known.second}\n$call").toList(), listOf(known))
            }
            assertThat(error.message).contains(call.lineSequence().last().trim())
        }
    }

    private fun checkInventory(actual: List<Pair<String, String>>, documented: List<Pair<String, String>>) {
        assertThat(actual).containsExactlyElementsIn(documented)
    }

    private fun callSites(path: String, contents: String): Sequence<Pair<String, String>> {
        return calls.findAll(contents).mapNotNull { match ->
            val lineStart = contents.lastIndexOf('\n', match.range.first - 1) + 1
            val lineEnd = contents.indexOf('\n', match.range.first).takeIf { it >= 0 } ?: contents.length
            val line = contents.substring(lineStart, lineEnd).trim()
            if (contents.indexOf("//", lineStart) in lineStart until match.range.first) return@mapNotNull null
            // AlarmManager.set has a generic name. These two calls write a QR bit array.
            if (path == "ui/qr/BitBuffer.java" && line in setOf(
                    "data.set(bitLength, QrCode.getBit(val, i));",
                    "data.set(bitLength, bb.data.get(i));",
                )
            ) null else path to line
        }
    }
}
