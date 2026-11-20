// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.update.AppUpdateLog.Trigger
import org.plainphone.app.update.AppUpdateLog.Verdict
import org.robolectric.RobolectricTestRunner

/** The guard and the report of an app update window (Robolectric only for org.json). */
@RunWith(RobolectricTestRunner::class)
class AppUpdateLogTest {
    private class MemoryStore : AppUpdateLog.Store {
        var window: AppUpdateLog.Window? = null
        override fun load() = window?.let { AppUpdateLog.Window.parse(it.toJson().toString()) }
        override fun save(window: AppUpdateLog.Window) { this.window = window }
    }

    private val store = MemoryStore()
    private val log = AppUpdateLog(store)
    private val opened = 1_000_000L
    private val until = opened + AppUpdateWindow.WINDOW_MS

    private fun open() = log.opened("w1", Trigger.NIGHT, opened, until, setOf("com.maps", "com.android.vending", "com.game"))

    @Test fun `an update of an installed app is allowed and counted`() {
        open()
        assertThat(log.packageAdded("com.maps", replacing = true, opened + 10, leaseOpen = true)).isEqualTo(Verdict.UPDATED)
        assertThat(log.packageAdded("com.maps", replacing = true, opened + 20, leaseOpen = true)).isEqualTo(Verdict.UPDATED)
        assertThat(log.report(opened + 30, leaseOpen = true)!!.updated).isEqualTo(1)
    }

    @Test fun `a new app is hidden and reported`() {
        open()
        assertThat(log.packageAdded("com.tiktok", replacing = false, opened + 10, leaseOpen = true)).isEqualTo(Verdict.HIDE)
        assertThat(log.report(opened + 20, leaseOpen = true)!!.caught).containsExactly("com.tiktok")
    }

    @Test fun `an app shown again is not new`() {
        // Showing a hidden app (Play at the start of the window) makes Android send "added".
        open()
        assertThat(log.packageAdded("com.android.vending", replacing = false, opened + 10, leaseOpen = true))
            .isEqualTo(Verdict.IGNORE)
        assertThat(log.packageAdded("com.game", replacing = false, opened + 10, leaseOpen = true)).isEqualTo(Verdict.IGNORE)
    }

    @Test fun `nothing is judged outside a window`() {
        assertThat(log.packageAdded("com.tiktok", replacing = false, opened, leaseOpen = false)).isEqualTo(Verdict.IGNORE)
        open()
        val late = until + AppUpdateLog.LATE_BROADCAST_MS + 1
        assertThat(log.packageAdded("com.tiktok", replacing = false, late, leaseOpen = false)).isEqualTo(Verdict.IGNORE)
    }

    @Test fun `a broadcast that arrives just after the window still counts`() {
        open()
        assertThat(log.packageAdded("com.tiktok", replacing = false, until + 5_000, leaseOpen = false)).isEqualTo(Verdict.HIDE)
    }

    @Test fun `the end is the deadline when the lease ran out unseen`() {
        open()
        val report = log.report(until + 3_600_000, leaseOpen = false)!!
        assertThat(report.openedAtMs).isEqualTo(opened)
        assertThat(report.closedAtMs).isEqualTo(until)
    }

    @Test fun `the end is the moment it was seen closed after process death`() {
        open()
        val report = log.report(opened + 60_000, leaseOpen = false)!!
        assertThat(report.closedAtMs).isEqualTo(opened + 60_000)
        // Later reports keep the first end.
        assertThat(log.report(opened + 120_000, leaseOpen = false)!!.closedAtMs).isEqualTo(opened + 60_000)
    }

    @Test fun `an open window has no end yet`() {
        open()
        assertThat(log.report(opened + 60_000, leaseOpen = true)!!.closedAtMs).isNull()
    }

    @Test fun `the toggle and the parent's request come from the rules, old servers mean on`() {
        assertThat(org.plainphone.app.sync.AppUpdateRules.parse(null).automatic).isTrue()
        val rules = org.plainphone.app.sync.AppUpdateRules.parse(
            org.json.JSONObject("""{"automatic":false,"requestedAt":"2026-06-10T12:00:00Z","reportedWindow":"w1","recordedApps":["com.game"]}"""),
        )
        assertThat(rules.automatic).isFalse()
        assertThat(rules.requestedAt).isEqualTo(java.time.Instant.parse("2026-06-10T12:00:00Z"))
        assertThat(rules.reportedWindow).isEqualTo("w1")
        assertThat(rules.recordedApps).containsExactly("com.game")
        val none = org.plainphone.app.sync.AppUpdateRules.parse(
            org.json.JSONObject("""{"automatic":true,"requestedAt":null,"reportedWindow":null}"""),
        )
        assertThat(none.requestedAt).isNull()
        assertThat(none.reportedWindow).isNull()
        assertThat(none.recordedApps).isEmpty()
    }

    @Test fun `a window that could not open says why and judges nothing`() {
        log.failed("w2", Trigger.PARENT, opened, "batteryExemption")
        val report = log.report(opened + 10, leaseOpen = false)!!
        assertThat(report.openedAtMs).isNull()
        assertThat(report.error).isEqualTo("batteryExemption")
        assertThat(report.trigger).isEqualTo(Trigger.PARENT)
        assertThat(log.packageAdded("com.tiktok", replacing = false, opened + 10, leaseOpen = false)).isEqualTo(Verdict.IGNORE)
    }
}
