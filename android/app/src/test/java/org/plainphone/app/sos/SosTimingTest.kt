// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.telecom.Call
import kotlinx.coroutines.flow.MutableStateFlow
import org.plainphone.app.telephony.CallUi
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
    fun `disconnect a ringing call on timeout before calling the next parent`(): Unit = runBlocking {
        val order = mutableListOf<String>()
        val state = MutableStateFlow(emptyList<CallUi>())
        callSosParents(listOf(1, 2, 3)) { id ->
            order += "call $id"
            val answered = id == 2
            state.value = listOf(CallUi(id, null, null, if (answered) Call.STATE_ACTIVE else Call.STATE_DIALING, false, null))
            awaitSosAnswer(id, state, disconnect = { ended ->
                order += "disconnect $ended"
                state.value = emptyList()
            }, ringMs = 30)
        }
        assertThat(order).containsExactly("call 1", "disconnect 1", "call 2").inOrder()
    }

    @Test
    fun `stop calling prevents escalation`(): Unit = runBlocking {
        val attempts = mutableListOf<String>()
        callSosParents(listOf("one", "two")) { parent ->
            attempts += parent
            SosCallOutcome.STOPPED
        }
        assertThat(attempts).containsExactly("one")
    }
}
