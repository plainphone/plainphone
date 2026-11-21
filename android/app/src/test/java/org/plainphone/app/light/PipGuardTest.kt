// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.time.Duration
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow

/** The decision (pure) and the guard: a blocked app playing in picture-in-picture is closed. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [GuardServiceTest.ServiceShadow::class, GuardServiceTest.WindowShadow::class])
class PipGuardTest {
    private val game = "com.example.game"
    private val video = "com.example.video"
    private val fine = "com.example.fine"
    private val plan = LightPlan(blocked = setOf(game), timeBlocked = setOf(video))

    private fun decide(vararg w: PipGuard.Win, opened: Set<String> = emptySet()) =
        PipGuard.targets(w.toList(), "org.plainphone.app", plan) { it in opened }

    @Test fun `a blocked app in picture-in-picture is a target`() {
        assertEquals(
            listOf(PipGuard.Target(game, LightPlan.Why.NOT_ALLOWED), PipGuard.Target(video, LightPlan.Why.TIME_USED_UP)),
            decide(PipGuard.Win(game, true), PipGuard.Win(video, true)),
        )
    }

    @Test fun `an allowed app, a blocked app in a normal window, and unreadable windows are left alone`() {
        assertEquals(emptyList<PipGuard.Target>(), decide(PipGuard.Win(fine, true), PipGuard.Win(game, false), PipGuard.Win(null, true)))
    }

    @Test fun `Plainphone itself is never a target`() {
        val own = LightPlan(blocked = setOf("org.plainphone.app"), timeBlocked = emptySet())
        assertEquals(emptyList<PipGuard.Target>(), PipGuard.targets(listOf(PipGuard.Win("org.plainphone.app", true)), "org.plainphone.app", own) { false })
    }

    @Test fun `an active emergency opening keeps its app in picture-in-picture, others still go`() {
        assertEquals(
            listOf(PipGuard.Target(video, LightPlan.Why.TIME_USED_UP)),
            decide(PipGuard.Win(game, true), PipGuard.Win(video, true), opened = setOf(game)),
        )
    }

    private lateinit var service: GuardService
    private lateinit var shadow: GuardServiceTest.ServiceShadow

    @Before fun setUp() {
        service = Robolectric.buildService(GuardService::class.java).create().get()
        service.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE).edit().putBoolean("complete", true).apply()
        service.getSharedPreferences("plainphone_light", Context.MODE_PRIVATE).edit()
            .putStringSet("blocked", setOf(game)).putStringSet("time_blocked", setOf(video)).apply()
        shadow = Shadow.extract(service)
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(10))
    }

    private fun window(pkg: String, pip: Boolean) = AccessibilityWindowInfo().also {
        Shadow.extract<GuardServiceTest.WindowShadow>(it).apply {
            rootNode = AccessibilityNodeInfo().apply { packageName = pkg }
            this.pip = pip
        }
    }

    private fun windowsChanged() = service.onAccessibilityEvent(AccessibilityEvent(AccessibilityEvent.TYPE_WINDOWS_CHANGED))

    private fun homeActions() = shadow.globalActions.count { it == AccessibilityService.GLOBAL_ACTION_HOME }

    @Test fun `a windows-changed event closes a blocked app that entered picture-in-picture`() {
        shadow.windowList = listOf(window("com.android.launcher", false), window(game, true))
        windowsChanged()
        assertEquals(1, homeActions())
        assertEquals(BlockedActivity::class.java.name, shadowOf(service.application).nextStartedActivity.component?.className)
    }

    @Test fun `an app already stopped is not a target again`() {
        assertEquals(
            listOf(PipGuard.Target(video, LightPlan.Why.TIME_USED_UP)),
            PipGuard.targets(listOf(PipGuard.Win(game, true), PipGuard.Win(video, true)), "org.plainphone.app", plan, setOf(game)) { false },
        )
    }

    @Test fun `a window that will not close is stopped once, not on every event and tick`() {
        shadow.windowList = listOf(window(game, true))
        windowsChanged()
        assertEquals(1, homeActions())
        repeat(3) {
            shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
            windowsChanged()
        }
        org.robolectric.util.ReflectionHelpers.callInstanceMethod<Unit>(service, "onServiceConnected")
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(65))
        assertEquals(1, homeActions())
    }

    @Test fun `the same app is stopped again when it returns to picture-in-picture after the window was gone`() {
        shadow.windowList = listOf(window(game, true))
        windowsChanged()
        shadow.windowList = listOf(window("com.android.launcher", false))
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        windowsChanged()
        shadow.windowList = listOf(window(game, true))
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        windowsChanged()
        assertEquals(2, homeActions())
    }

    @Test fun `a call in progress is not pushed aside by the stop screen`() {
        val audio = service.getSystemService(android.media.AudioManager::class.java)
        audio.mode = android.media.AudioManager.MODE_IN_CALL
        shadow.windowList = listOf(window(game, true))
        windowsChanged()
        assertEquals(0, homeActions())
        audio.mode = android.media.AudioManager.MODE_NORMAL
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        windowsChanged()
        assertEquals(1, homeActions())
    }

    @Test fun `an allowed app in picture-in-picture is not touched`() {
        shadow.windowList = listOf(window(fine, true))
        windowsChanged()
        assertEquals(0, homeActions())
    }

    @Test fun `the tick catches a picture-in-picture app whose block was dropped`() {
        shadow.windowList = listOf(window(video, true))
        // No event arrives: only the 30 s tick looks.
        org.robolectric.util.ReflectionHelpers.callInstanceMethod<Unit>(service, "onServiceConnected")
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(31))
        assertTrue(homeActions() >= 1)
    }

    @Test fun `an emergency opening lets its app stay in picture-in-picture`() {
        val started = EmergencyOpenings.of(service).start(
            game, BlockedActivity.Reason.NOT_ALLOWED, true, EmergencyRules(true, 3, 15, null, 0),
            ZoneId.of("Europe/Copenhagen"), service.packageName,
        )
        assertTrue(started is EmergencyStart.Started)
        shadow.windowList = listOf(window(game, true))
        windowsChanged()
        assertEquals(0, homeActions())
    }
}
