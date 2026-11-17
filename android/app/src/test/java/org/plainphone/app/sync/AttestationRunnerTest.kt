// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.util.Base64
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Robolectric for android.util.Log. */
@RunWith(RobolectricTestRunner::class)
class AttestationRunnerTest {
    private class MemStore : AttestationStore {
        override var attestedAtMs = 0L
        override var state: String? = null
    }

    private class FakeApi(var fail: Boolean = false) : AttestationApi {
        var submitted: Pair<String, List<ByteArray>>? = null
        val challenge = Base64.getUrlEncoder().withoutPadding().encodeToString("server-challenge".toByteArray())
        override fun challenge(token: String): String {
            check(!fail) { "offline" }
            return challenge
        }
        override fun submit(token: String, challenge: String, chain: List<ByteArray>): String {
            submitted = challenge to chain
            return "unlocked"
        }
    }

    @Test
    fun `the key is made with the server's challenge and the verdict is kept`() {
        val api = FakeApi()
        var seen: ByteArray? = null
        val store = MemStore()
        val runner = AttestationRunner(api, { c -> seen = c; listOf(byteArrayOf(1), byteArrayOf(2)) }, store, nowMs = { 100L * AttestationRunner.EVERY_MS })
        assertThat(runner.runIfDue("t")).isEqualTo("unlocked")
        assertThat(String(seen!!)).isEqualTo("server-challenge")
        assertThat(api.submitted!!.first).isEqualTo(api.challenge)
        assertThat(store.state).isEqualTo("unlocked")
    }

    @Test
    fun `it runs once a day, also after a failure`() {
        val api = FakeApi(fail = true)
        var now = 10 * AttestationRunner.EVERY_MS
        val runner = AttestationRunner(api, { listOf(byteArrayOf(1), byteArrayOf(2)) }, MemStore(), nowMs = { now })
        assertThat(runner.runIfDue("t")).isNull()
        api.fail = false
        now += AttestationRunner.EVERY_MS / 2
        assertThat(runner.runIfDue("t")).isNull()
        assertThat(api.submitted).isNull()
        now += AttestationRunner.EVERY_MS
        assertThat(runner.runIfDue("t")).isEqualTo("unlocked")
    }
}
