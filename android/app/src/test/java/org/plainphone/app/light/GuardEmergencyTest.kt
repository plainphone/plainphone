// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.os.SystemClock
import android.view.accessibility.AccessibilityEvent
import java.time.Duration
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow

/**
 * While an emergency opening covers an app, the guard leaves it alone; when the window ends it blocks
 * again at once, also while the app stays in front. Real (Robolectric) clocks, advanced by the test.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [GuardServiceTest.ServiceShadow::class, GuardServiceTest.WindowShadow::class])
class GuardEmergencyTest {
    private val game = "com.example.game"
    private val video = "com.example.video"
    private lateinit var service: GuardService
    private lateinit var shadow: GuardServiceTest.ServiceShadow

    @Before fun setUp() {
        service = Robolectric.buildService(GuardService::class.java).create().get()
        service.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE).edit().putBoolean("complete", true).apply()
        // The plan the lock stored: one app outside the allow-list, one with its time used up.
        service.getSharedPreferences("plainphone_light", Context.MODE_PRIVATE).edit()
            .putStringSet("blocked", setOf(game)).putStringSet("time_blocked", setOf(video)).apply()
        shadow = Shadow.extract(service)
        // The guard rate-limits blocks to one per 700 ms from time zero.
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(10))
    }

    private fun front(pkg: String) = service.onAccessibilityEvent(AccessibilityEvent(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED).apply { packageName = pkg })

    private fun homeActions() = shadow.globalActions.count { it == AccessibilityService.GLOBAL_ACTION_HOME }

    private fun open(pkg: String, reason: BlockedActivity.Reason) {
        val started = EmergencyOpenings.of(service).start(
            pkg, reason, true, EmergencyRules(true, 3, 15, null, 0), ZoneId.of("Europe/Copenhagen"), service.packageName,
        )
        assertTrue(started is EmergencyStart.Started)
    }

    @Test fun `an app outside the allow-list is blocked as before`() {
        front(game)
        assertEquals(1, homeActions())
    }

    @Test fun `during an opening the app is left alone, and blocked again when it ends`() {
        open(game, BlockedActivity.Reason.NOT_ALLOWED)
        front(game)
        assertEquals("not blocked while the window is open", 0, homeActions())

        // Fourteen minutes in: still open, nothing scheduled blocks it.
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMinutes(14))
        assertEquals(0, homeActions())

        // The expiry check fires by itself, with no window event, and blocks the app that stayed in front.
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMinutes(2))
        assertFalse(EmergencyOpenings.of(service).isActive(game))
        assertEquals("blocked again at the end of the window", 1, homeActions())
    }

    @Test fun `a used-up time limit is opened too`() {
        open(video, BlockedActivity.Reason.TIME_USED_UP)
        front(video)
        assertEquals(0, homeActions())
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMinutes(16))
        assertEquals(1, homeActions())
    }

    @Test fun `an opening covers one app only`() {
        open(game, BlockedActivity.Reason.NOT_ALLOWED)
        front(video)
        assertEquals("another blocked app is still blocked", 1, homeActions())
    }

    @Test fun `without a recorded opening nothing changes after the time passes`() {
        front(game)
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMinutes(20))
        assertEquals(1, homeActions())
    }

    @Test fun `a reboot during the window ends it`() {
        open(game, BlockedActivity.Reason.NOT_ALLOWED)
        // elapsedRealtime goes backwards after a reboot: the saved start is now in the future.
        val prefs = service.getSharedPreferences("plainphone_emergency_openings", Context.MODE_PRIVATE)
        val state = EmergencyJson.read(prefs.getString("state", null))
        prefs.edit().putString("state", EmergencyJson.write(state.copy(active = state.active!!.copy(startElapsedMs = SystemClock.elapsedRealtime() + 600_000L)))).commit()
        front(game)
        assertEquals(1, homeActions())
    }
}
