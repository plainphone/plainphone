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
                file.readLines().asSequence().filter(calls::containsMatchIn)
                    .map { file.relativeTo(app).invariantSeparatorsPath to it.trim() }
            }.toList()
        val row = Regex("""^\| `([^`]+)` `([^`]+)` \|""")
        val documented = File("../../docs/wakeups.md").readLines().mapNotNull { line ->
            row.find(line)?.let { it.groupValues[1] to it.groupValues[2] }
        }
        assertThat(actual).isNotEmpty()
        assertThat(actual).containsExactlyElementsIn(documented)
    }
}
