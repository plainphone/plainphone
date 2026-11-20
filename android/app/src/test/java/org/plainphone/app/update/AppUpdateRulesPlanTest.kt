// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import org.junit.Test
import org.plainphone.app.sync.AppUpdateRules
import org.plainphone.app.update.AppUpdateLog.Trigger

/** What the phone does with the app update rules after a sync (AppUpdateWindow.onRules). */
class AppUpdateRulesPlanTest {
    private val now = Instant.parse("2026-06-10T12:00:00Z").toEpochMilli()

    private fun plan(
        rules: AppUpdateRules = AppUpdateRules(),
        heldBack: Set<String> = emptySet(),
        handled: Long = 0L,
        open: Trigger? = null,
    ) = AppUpdateWindow.plan(rules, heldBack, handled, open, now)

    @Test fun `nothing to do with default rules`() {
        assertThat(plan()).isEqualTo(AppUpdateWindow.RulesPlan())
    }

    @Test fun `a held-back app is let go once the server has recorded it, whatever window it came with`() {
        // Caught in w1, reported under w2: the server lists the app, so the hold ends.
        val rules = AppUpdateRules(reportedWindow = "w2", recordedApps = setOf("com.game"))
        assertThat(plan(rules, heldBack = setOf("com.game")).letGo).containsExactly("com.game")
    }

    @Test fun `an app the server has not recorded yet stays held back, even in a recorded window`() {
        // w1 was recorded with com.game; com.chat was caught later in the same window.
        val rules = AppUpdateRules(reportedWindow = "w1", recordedApps = setOf("com.game"))
        assertThat(plan(rules, heldBack = setOf("com.game", "com.chat")).letGo).containsExactly("com.game")
        assertThat(plan(AppUpdateRules(reportedWindow = "w1"), heldBack = setOf("com.chat")).letGo).isEmpty()
    }

    @Test fun `switching the toggle off closes a nightly window but not one a parent asked for`() {
        val off = AppUpdateRules(automatic = false)
        assertThat(plan(off, open = Trigger.NIGHT).closeNightly).isTrue()
        assertThat(plan(off, open = Trigger.PARENT).closeNightly).isFalse()
        assertThat(plan(off, open = null).closeNightly).isFalse()
        assertThat(plan(AppUpdateRules(automatic = true), open = Trigger.NIGHT).closeNightly).isFalse()
    }

    @Test fun `Update apps now opens a window once per request`() {
        val asked = now - 60_000
        val rules = AppUpdateRules(requestedAt = Instant.ofEpochMilli(asked))
        val first = plan(rules)
        assertThat(first.handleRequest).isEqualTo(asked)
        assertThat(first.openForParent).isTrue()
        val again = plan(rules, handled = asked)
        assertThat(again.handleRequest).isNull()
        assertThat(again.openForParent).isFalse()
    }

    @Test fun `Update apps now also works with the toggle off`() {
        val rules = AppUpdateRules(automatic = false, requestedAt = Instant.ofEpochMilli(now - 1_000))
        assertThat(plan(rules).openForParent).isTrue()
    }

    @Test fun `a request older than a day is marked handled but opens nothing`() {
        val asked = now - AppUpdateWindow.REQUEST_MAX_AGE_MS - 1
        val stale = plan(AppUpdateRules(requestedAt = Instant.ofEpochMilli(asked)))
        assertThat(stale.handleRequest).isEqualTo(asked)
        assertThat(stale.openForParent).isFalse()
        val edge = now - AppUpdateWindow.REQUEST_MAX_AGE_MS
        assertThat(plan(AppUpdateRules(requestedAt = Instant.ofEpochMilli(edge))).openForParent).isTrue()
    }
}
