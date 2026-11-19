// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import com.google.common.truth.Truth.assertThat
import kotlinx.coroutines.runBlocking
import org.junit.Test

class SosTimingTest {
    @Test
    fun `help waits for the cancel window and sends at most once`() {
        val confirmation = SosConfirmation(SosKind.HELP, 1_000)
        assertThat(confirmation.sendIfDue(5_999)).isNull()
        assertThat(confirmation.sendIfDue(6_000)).isEqualTo(SosKind.HELP)
        assertThat(confirmation.sendIfDue(7_000)).isNull()
    }

    @Test
    fun `undo prevents sending even after the deadline`() {
        val confirmation = SosConfirmation(SosKind.URGENT, 1_000)
        confirmation.cancel()
        assertThat(confirmation.sendIfDue(6_000)).isNull()
    }

    @Test
    fun `call another parent when unanswered and stop when answered`() = runBlocking {
        val attempts = mutableListOf<String>()
        callSosParents(listOf("one", "two", "three")) { parent ->
            attempts += parent
            if (parent == "one") SosCallOutcome.UNANSWERED else SosCallOutcome.ANSWERED
        }
        assertThat(attempts).containsExactly("one", "two").inOrder()
    }

    @Test
    fun `stop calling prevents escalation`() = runBlocking {
        val attempts = mutableListOf<String>()
        callSosParents(listOf("one", "two")) { parent ->
            attempts += parent
            SosCallOutcome.STOPPED
        }
        assertThat(attempts).containsExactly("one")
    }
}
