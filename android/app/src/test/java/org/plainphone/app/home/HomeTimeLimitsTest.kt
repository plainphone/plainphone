// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.plainphone.app.sync.TimeLimits

class HomeTimeLimitsTest {
    private fun evaluation(total: Long?, apps: Map<String, Long>) =
        TimeLimits.Evaluation(totalRemainingMs = total, appRemainingMs = apps, totalUsedMs = 0, usedMs = emptyMap())

    @Test
    fun ownCapIsRoundedUpAndUsedUpIsZero() {
        val left = HomeTimeLimits.minutesLeft(
            evaluation(total = null, apps = mapOf("game" to 61_000L, "video" to 0L)),
            exempt = emptySet(),
            packages = listOf("game", "video", "music"),
        )
        assertThat(left).containsExactly("game", 2, "video", 0)
    }

    @Test
    fun totalCapAppliesToEveryAppButCoreApps() {
        val left = HomeTimeLimits.minutesLeft(
            evaluation(total = 30 * 60_000L, apps = mapOf("game" to 10 * 60_000L)),
            exempt = setOf("dialer"),
            packages = listOf("game", "music", "dialer"),
        )
        assertThat(left).containsExactly("game", 10, "music", 30)
    }

    @Test
    fun noLimitsMeansNothingShown() {
        assertThat(HomeTimeLimits.minutesLeft(evaluation(null, emptyMap()), emptySet(), listOf("game"))).isEmpty()
    }
}
