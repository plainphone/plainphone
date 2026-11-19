// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.quiet

import android.app.NotificationManager
import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** Do Not Disturb for bedtime: switched on, and the phone's own setting put back afterwards. */
class BedtimeDndTest {
    private class FakeZen(override var hasAccess: Boolean = true) : ZenControls {
        override var filter = NotificationManager.INTERRUPTION_FILTER_ALL
        override var policy = ZenPolicy(categories = 0b10101, callSenders = 1, messageSenders = 2, visualEffects = 3)
    }

    private class FakeStore : DndStore {
        override var active = false
        override var previousFilter = NotificationManager.INTERRUPTION_FILTER_ALL
        override var previousPolicy: ZenPolicy? = null
    }

    private val zen = FakeZen()
    private val store = FakeStore()
    private val dnd = BedtimeDnd(zen, store)
    private val own = zen.policy

    @Test
    fun `bedtime lets only alarms and calls through`() {
        assertThat(dnd.apply(silent = true)).isEqualTo(DndOutcome.ACTIVE)
        assertThat(zen.filter).isEqualTo(NotificationManager.INTERRUPTION_FILTER_PRIORITY)
        val categories = zen.policy.categories
        assertThat(categories and NotificationManager.Policy.PRIORITY_CATEGORY_CALLS).isNotEqualTo(0)
        assertThat(categories and NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS).isNotEqualTo(0)
        assertThat(categories and NotificationManager.Policy.PRIORITY_CATEGORY_MESSAGES).isEqualTo(0)
        assertThat(categories and NotificationManager.Policy.PRIORITY_CATEGORY_EVENTS).isEqualTo(0)
        assertThat(categories and NotificationManager.Policy.PRIORITY_CATEGORY_REMINDERS).isEqualTo(0)
        assertThat(categories and NotificationManager.Policy.PRIORITY_CATEGORY_MEDIA).isEqualTo(0)
    }

    @Test
    fun `the phone's own Do Not Disturb setting comes back when bedtime ends`() {
        zen.filter = NotificationManager.INTERRUPTION_FILTER_ALARMS
        dnd.apply(silent = true)
        assertThat(dnd.apply(silent = false)).isEqualTo(DndOutcome.RESTORED)
        assertThat(zen.filter).isEqualTo(NotificationManager.INTERRUPTION_FILTER_ALARMS)
        assertThat(zen.policy).isEqualTo(own)
        assertThat(store.active).isFalse()
    }

    @Test
    fun `applying again during bedtime does not overwrite what was saved`() {
        dnd.apply(silent = true)
        assertThat(dnd.apply(silent = true)).isEqualTo(DndOutcome.ACTIVE)
        dnd.apply(silent = false)
        assertThat(zen.filter).isEqualTo(NotificationManager.INTERRUPTION_FILTER_ALL)
        assertThat(zen.policy).isEqualTo(own)
    }

    @Test
    fun `someone who turns Do Not Disturb off during bedtime is not overridden afterwards`() {
        dnd.apply(silent = true)
        zen.filter = NotificationManager.INTERRUPTION_FILTER_ALL
        zen.policy = own.copy(categories = 7)
        assertThat(dnd.apply(silent = false)).isEqualTo(DndOutcome.IDLE)
        assertThat(zen.filter).isEqualTo(NotificationManager.INTERRUPTION_FILTER_ALL)
        assertThat(zen.policy.categories).isEqualTo(7)
        assertThat(store.active).isFalse()
    }

    @Test
    fun `daytime with nothing set does nothing`() {
        assertThat(dnd.apply(silent = false)).isEqualTo(DndOutcome.IDLE)
        assertThat(zen.filter).isEqualTo(NotificationManager.INTERRUPTION_FILTER_ALL)
        assertThat(zen.policy).isEqualTo(own)
    }

    @Test
    fun `without Android's access nothing is changed and the phone says so`() {
        zen.hasAccess = false
        assertThat(dnd.apply(silent = true)).isEqualTo(DndOutcome.NO_ACCESS)
        assertThat(zen.filter).isEqualTo(NotificationManager.INTERRUPTION_FILTER_ALL)
        assertThat(zen.policy).isEqualTo(own)
        assertThat(dnd.apply(silent = false)).isEqualTo(DndOutcome.IDLE)
    }

    @Test
    fun `access taken away during bedtime is forgotten, so a later grant starts clean`() {
        dnd.apply(silent = true)
        zen.hasAccess = false
        assertThat(dnd.apply(silent = false)).isEqualTo(DndOutcome.IDLE)
        assertThat(store.active).isFalse()
        zen.hasAccess = true
        zen.filter = NotificationManager.INTERRUPTION_FILTER_NONE
        dnd.apply(silent = true)
        dnd.apply(silent = false)
        assertThat(zen.filter).isEqualTo(NotificationManager.INTERRUPTION_FILTER_NONE)
    }
}
