// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class PowerPressCounterTest {
    private fun PowerPressCounter.feed(needed: Int, vararg at: Long) = at.map { press(it, needed) }

    @Test
    fun `fires once when enough presses fall within three seconds`() {
        val counter = PowerPressCounter()
        assertThat(counter.feed(4, 1_000, 1_400, 1_800, 2_200)).containsExactly(false, false, false, true).inOrder()
    }

    @Test
    fun `slow presses never fire`() {
        val counter = PowerPressCounter()
        assertThat(counter.feed(4, 0, 1_100, 2_200, 3_300, 4_400, 5_500, 6_600)).doesNotContain(true)
    }

    @Test
    fun `the window is three seconds from the first counted press`() {
        val counter = PowerPressCounter()
        // 0 falls out when 3_001 arrives, so only three presses are within the window.
        assertThat(counter.feed(4, 0, 1_000, 2_000, 3_001)).doesNotContain(true)
        assertThat(counter.press(3_500, 4)).isTrue()
        // Exactly three seconds still counts.
        val edge = PowerPressCounter()
        assertThat(edge.feed(3, 100_000, 101_000, 103_000)).containsExactly(false, false, true).inOrder()
    }

    @Test
    fun `one burst sends one SOS, the next one after the cool-down`() {
        val counter = PowerPressCounter()
        // Five presses with four needed: the fifth is part of the same burst.
        assertThat(counter.feed(4, 0, 300, 600, 900, 1_200)).containsExactly(false, false, false, true, false).inOrder()
        // Still inside the 10 s cool-down: nothing, and nothing is carried over.
        assertThat(counter.feed(4, 5_000, 5_300, 5_600, 5_900)).doesNotContain(true)
        assertThat(counter.feed(4, 11_000, 11_300, 11_600)).doesNotContain(true)
        assertThat(counter.press(11_900, 4)).isTrue()
    }

    @Test
    fun `the number of presses follows the parents' choice`() {
        assertThat(PowerPressCounter().feed(3, 0, 200, 400)).containsExactly(false, false, true).inOrder()
        assertThat(PowerPressCounter().feed(6, 0, 200, 400, 600, 800)).doesNotContain(true)
        assertThat(PowerPressCounter().feed(6, 0, 200, 400, 600, 800, 1_000).last()).isTrue()
    }

    @Test
    fun `reset forgets presses so far`() {
        val counter = PowerPressCounter()
        counter.feed(4, 0, 200, 400)
        counter.reset()
        assertThat(counter.press(600, 4)).isFalse()
    }
}
