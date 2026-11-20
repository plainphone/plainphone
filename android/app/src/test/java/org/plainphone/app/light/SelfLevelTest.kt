// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import org.junit.Test
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull

class SelfLevelTest {
    @Test fun `a trusted person is strict whatever the wait time says`() {
        assertEquals(SelfLevel.STRICT, SelfLevel.of(null, true))
        assertEquals(SelfLevel.STRICT, SelfLevel.of(1, true))
        assertEquals(SelfLevel.STRICT, SelfLevel.of(72, true))
    }

    @Test fun `one hour is mild and 24 hours is firm`() {
        assertEquals(SelfLevel.MILD, SelfLevel.of(1, false))
        assertEquals(SelfLevel.FIRM, SelfLevel.of(24, false))
    }

    @Test fun `every other wait time is custom`() {
        for (hours in SelfLevel.WAIT_HOURS - listOf(1, 24)) assertEquals("$hours", SelfLevel.CUSTOM, SelfLevel.of(hours, false))
    }

    @Test fun `nothing chosen is no level`() {
        assertNull(SelfLevel.of(null, false))
    }

    @Test fun `the levels use only wait times the server accepts`() {
        assertEquals(true, SelfLevel.MILD_HOURS in SelfLevel.WAIT_HOURS)
        assertEquals(true, SelfLevel.FIRM_HOURS in SelfLevel.WAIT_HOURS)
    }
}
