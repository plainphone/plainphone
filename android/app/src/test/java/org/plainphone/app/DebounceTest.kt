// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class DebounceTest {
    private var clock = 0L
    private var runs = 0
    private val scheduled = mutableListOf<Pair<Long, () -> Unit>>()
    private val debounce = Debounce(30_000L, { clock }, { delay, task -> scheduled += delay to task }) { runs++ }

    @Test fun `a flood of broadcasts gives one run now and one trailing run`() {
        repeat(100) { debounce.trigger(); clock += 10 }
        assertThat(runs).isEqualTo(1)
        assertThat(scheduled).hasSize(1)
        assertThat(scheduled.single().first).isEqualTo(30_000L - 10L)
        clock = 30_000L
        scheduled.single().second()
        assertThat(runs).isEqualTo(2)
    }

    @Test fun `a call after the gap runs at once`() {
        debounce.trigger()
        clock = 30_000L
        debounce.trigger()
        assertThat(runs).isEqualTo(2)
        assertThat(scheduled).isEmpty()
    }

    @Test fun `after the trailing run a new flood is folded again`() {
        debounce.trigger(); debounce.trigger()
        clock = 30_000L
        scheduled.removeLast().second()
        debounce.trigger()
        assertThat(runs).isEqualTo(2)
        assertThat(scheduled).hasSize(1)
    }

    @Test fun `nothing runs twice inside the gap`() {
        debounce.trigger()
        clock = 29_999L
        debounce.trigger()
        assertThat(runs).isEqualTo(1)
    }
}
