// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.util.Base64
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Robolectric for android.util.Log. */
@RunWith(RobolectricTestRunner::class)
class AttestationRunnerTest {
    private class MemStore : AttestationStore {
        override var attestedAtMs = 0L
        override var retrySoon = false
        override var state: String? = null
    }

    private class FakeApi(var fail: Boolean = false) : AttestationApi {
        var submitted: Pair<String, List<ByteArray>>? = null
        val challenge = Base64.getUrlEncoder().withoutPadding().encodeToString("server-challenge".toByteArray())
        override fun challenge(token: String): String {
            if (fail) throw IOException("offline")
            return challenge
        }
        override fun submit(token: String, challenge: String, chain: List<ByteArray>): String {
            submitted = challenge to chain
            return if (chain.isEmpty()) "unverifiable" else "unlocked"
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
    fun `keystore failure is reported as unverifiable`() {
        val api = FakeApi()
        val store = MemStore()
        val runner = AttestationRunner(api, { error("no hardware key") }, store, nowMs = { 10 * AttestationRunner.EVERY_MS })
        assertThat(runner.runIfDue("t")).isEqualTo("unverifiable")
        assertThat(api.submitted!!.second).isEmpty()
        assertThat(store.state).isEqualTo("unverifiable")
    }

    @Test
    fun `it retries an offline check in one hour then returns to daily checks`() {
        val api = FakeApi(fail = true)
        var now = 10 * AttestationRunner.EVERY_MS
        val runner = AttestationRunner(api, { listOf(byteArrayOf(1), byteArrayOf(2)) }, MemStore(), nowMs = { now })
        assertThat(runner.runIfDue("t")).isNull()
        api.fail = false
        now += AttestationRunner.RETRY_MS - 1
        assertThat(runner.runIfDue("t")).isNull()
        assertThat(api.submitted).isNull()
        now += 1
        assertThat(runner.runIfDue("t")).isEqualTo("unlocked")
        now += AttestationRunner.EVERY_MS - 1
        assertThat(runner.runIfDue("t")).isNull()
        now += 1
        assertThat(runner.runIfDue("t")).isEqualTo("unlocked")
    }
}
