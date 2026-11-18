// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import org.junit.Test

class LocationRetryTest {
    @Test
    fun `late polls skip missed slots and the last slot expires after 30 minutes`() {
        val start = 1_800_000_000_000L
        val minute = 60_000L
        val late = start + 11 * minute
        assertThat(SyncRunner.locationAttemptDue(start, start - 1, null)).isFalse()
        assertThat(SyncRunner.locationAttemptDue(start, late, null)).isTrue()
        assertThat(SyncRunner.locationAttemptDue(start, late + minute, late)).isFalse()
        assertThat(SyncRunner.locationAttemptDue(start, start + 15 * minute, late)).isTrue()
        assertThat(SyncRunner.locationAttemptDue(start, start + 29 * minute, null)).isTrue()
        assertThat(SyncRunner.locationAttemptDue(start, start + 30 * minute, null)).isFalse()
    }
}
