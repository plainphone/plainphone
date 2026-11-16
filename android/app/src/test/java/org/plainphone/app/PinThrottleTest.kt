// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PinThrottleTest {
    private var clock = 1_000_000L
    private val store = object : PinThrottle.Store {
        override var failures = 0
        override var lockedUntil = 0L
    }

    private fun throttle() = PinThrottle(store) { clock }

    @Test
    fun `four wrong PINs are free, the fifth locks for a minute`() {
        val t = throttle()
        repeat(4) { t.onFailure() }
        assertThat(t.remainingMs()).isEqualTo(0)
        t.onFailure()
        assertThat(t.remainingMs()).isEqualTo(60_000)
    }

    @Test
    fun `lockout doubles and is capped at an hour`() {
        assertThat(PinThrottle.lockoutMs(6)).isEqualTo(120_000)
        assertThat(PinThrottle.lockoutMs(7)).isEqualTo(240_000)
        assertThat(PinThrottle.lockoutMs(50)).isEqualTo(3_600_000)
    }

    @Test
    fun `a new throttle on the same store (app restart) keeps the lockout`() {
        repeat(5) { throttle().onFailure() }
        clock += 10_000
        assertThat(throttle().remainingMs()).isEqualTo(50_000)
    }

    @Test
    fun `the right PIN resets the count`() {
        val t = throttle()
        repeat(5) { t.onFailure() }
        t.onSuccess()
        assertThat(t.remainingMs()).isEqualTo(0)
        t.onFailure()
        assertThat(t.remainingMs()).isEqualTo(0)
    }
}
