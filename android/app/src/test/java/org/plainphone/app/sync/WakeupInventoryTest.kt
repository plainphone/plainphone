// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.io.File
import org.junit.Test

class WakeupInventoryTest {
    @Test
    fun `all wakeup call sites are documented`() {
        val source = File("src/main")
        val app = File(source, "java/org/plainphone/app")
        val calls = Regex("""\b(?:setExactAndAllowWhileIdle|setAndAllowWhileIdle|PeriodicWorkRequestBuilder|enqueueUnique\w*|registerReceiver|postDelayed)\s*[<(]""")
        val actual = source.walkTopDown()
            .filter { it.isFile && it.extension in setOf("kt", "java") }
            .flatMap { file ->
                val contents = file.readText()
                calls.findAll(contents).map { match ->
                    val lineStart = contents.lastIndexOf('\n', match.range.first - 1) + 1
                    val lineEnd = contents.indexOf('\n', match.range.first).takeIf { it >= 0 } ?: contents.length
                    val line = contents.substring(lineStart, lineEnd).trim()
                    file.relativeTo(app).invariantSeparatorsPath to line
                }
            }.toList()
        val row = Regex("""^\| `([^`]+)` `([^`]+)` \|""")
        val documented = File("../../docs/wakeups.md").readLines().mapNotNull { line ->
            row.find(line)?.let { it.groupValues[1] to it.groupValues[2] }
        }
        assertThat(actual).isNotEmpty()
        assertThat(actual).containsExactlyElementsIn(documented)
    }
}
