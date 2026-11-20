// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** `weeklySummaryEnabled` in the rules only drives the notice to the child (docs/weekly-summary.md). */
@RunWith(RobolectricTestRunner::class)
class WeeklySummaryRulesTest {
    private fun rules(extra: String) =
        ServerRules.parse(rulesJson().replace("\"pollSeconds\":60", "$extra\"pollSeconds\":60"))

    @Test
    fun `the notice follows the rules, and an old server that says nothing means off`() {
        assertThat(rules("\"weeklySummaryEnabled\":true,").weeklySummaryEnabled).isTrue()
        assertThat(rules("\"weeklySummaryEnabled\":false,").weeklySummaryEnabled).isFalse()
        assertThat(rules("").weeklySummaryEnabled).isFalse()
    }
}
