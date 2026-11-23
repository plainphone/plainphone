// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.time.Duration
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
import org.robolectric.util.ReflectionHelpers

/**
 * Moments where a blocked app could stay in front: a block that was rate-limited, a guard that restarts,
 * and rules that block an app already open.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [GuardServiceTest.ServiceShadow::class, GuardServiceTest.WindowShadow::class])
class GuardGapsTest {
    private val game = "com.example.game"
    private lateinit var service: GuardService
    private lateinit var shadow: GuardServiceTest.ServiceShadow

    @Before fun setUp() {
        service = Robolectric.buildService(GuardService::class.java).create().get()
        service.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE).edit().putBoolean("complete", true).apply()
        service.getSharedPreferences("plainphone_light", Context.MODE_PRIVATE).edit()
            .putStringSet("blocked", setOf(game)).apply()
        shadow = Shadow.extract(service)
        // The guard rate-limits blocks to one per 700 ms from time zero.
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(10))
    }

    private fun front(pkg: String) = service.onAccessibilityEvent(AccessibilityEvent(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED).apply { packageName = pkg })

    private fun homeActions() = shadow.globalActions.count { it == AccessibilityService.GLOBAL_ACTION_HOME }

    @Test fun `switching straight back to a blocked app is blocked once the rate limit is over`() {
        front(game)
        assertEquals(1, homeActions())
        // Quick switch back within the rate limit: this block is dropped for now.
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofMillis(100))
        front(game)
        assertEquals(1, homeActions())
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
        assertEquals("the dropped block is retried", 2, homeActions())
    }

    @Test fun `a blocked app brought back over its stop screen without a window state event is blocked again`() {
        front(game)
        assertEquals(1, homeActions())
        front(service.packageName) // the stop screen
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
        // A second start of the open game moves its task to the front: Android 14 reported only the focus change.
        shadow.windowList = listOf(AccessibilityWindowInfo().also {
            Shadow.extract<GuardServiceTest.WindowShadow>(it).apply {
                rootNode = AccessibilityNodeInfo().apply { packageName = game }
                focused = true
            }
        })
        service.onAccessibilityEvent(AccessibilityEvent(AccessibilityEvent.TYPE_WINDOWS_CHANGED).apply {
            ReflectionHelpers.setField(this, "mWindowChangeTypes", AccessibilityEvent.WINDOWS_CHANGE_FOCUSED)
        })
        assertEquals("the game is stopped again", 2, homeActions())
    }

    @Test fun `a blocked app that took focus back before its stop screen's events arrived is stopped again`() {
        // Emulator run 45047940235 (API 34): the test started the player again 150 ms after its stop screen.
        // The player's focus came first, the stop screen's late window events after it, so the guard took
        // its own screen for the app in front, and neither a retry nor the 30 s tick looked at the player.
        front(game)
        assertEquals(1, homeActions())
        shadow.windowList = listOf(AccessibilityWindowInfo().also {
            Shadow.extract<GuardServiceTest.WindowShadow>(it).apply {
                rootNode = AccessibilityNodeInfo().apply { packageName = game }
                focused = true
            }
        })
        shadow.root = AccessibilityNodeInfo().apply { packageName = game }
        service.onAccessibilityEvent(AccessibilityEvent(AccessibilityEvent.TYPE_WINDOWS_CHANGED).apply {
            ReflectionHelpers.setField(this, "mWindowChangeTypes", AccessibilityEvent.WINDOWS_CHANGE_FOCUSED)
        })
        front(service.packageName) // the stop screen's event, late
        // Within a second: the focus event's rate-limited block is retried on the live window, before
        // the stop screen's own settle check (1.5 s) would look.
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
        assertEquals("the game is stopped again", 2, homeActions())
    }

    @Test fun `a blocked app still in front after its stop screen is stopped again without any event`() {
        front(game)
        assertEquals(1, homeActions())
        front(service.packageName) // the stop screen
        // The game's task returns and Android reports nothing: only the active window says so.
        shadow.root = AccessibilityNodeInfo().apply { packageName = game }
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(2))
        assertEquals("the game is stopped again", 2, homeActions())
    }

    @Test fun `a guard that restarts checks the app already in front`() {
        shadow.root = AccessibilityNodeInfo().apply { packageName = game }
        ReflectionHelpers.callInstanceMethod<Unit>(service, "onServiceConnected")
        shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals(1, homeActions())
    }

    @Test fun `a guard that restarts during a maintenance unlock leaves the app alone`() {
        service.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE).edit()
            .putLong("relock_at_wall", System.currentTimeMillis() + 60_000).apply()
        shadow.root = AccessibilityNodeInfo().apply { packageName = game }
        ReflectionHelpers.callInstanceMethod<Unit>(service, "onServiceConnected")
        shadowOf(android.os.Looper.getMainLooper()).idle()
        assertEquals(0, homeActions())
    }

    @Test fun `a floating window seen only as System UI after Home came first is not taken for the launcher`() {
        // Android 10: the video app enters picture-in-picture from Home, the launcher's window event comes
        // before the window list changes, and the pinned window reads as System UI under an id never seen
        // in full screen. The window is the video app's, not the launcher's, so new rules stop it.
        val video = "com.example.video"
        val launcher = "com.example.launcher"
        shadowOf(service.packageManager).addResolveInfoForIntent(
            android.content.Intent(android.content.Intent.ACTION_MAIN).addCategory(android.content.Intent.CATEGORY_HOME),
            android.content.pm.ResolveInfo().apply {
                activityInfo = android.content.pm.ActivityInfo().apply { packageName = launcher; name = "Home" }
            },
        )
        front(video)
        front(launcher)
        shadow.windowList = listOf(AccessibilityWindowInfo().also {
            Shadow.extract<GuardServiceTest.WindowShadow>(it).apply {
                rootNode = AccessibilityNodeInfo().apply { packageName = "com.android.systemui" }
                windowId = 14
                pip = true
            }
        })
        service.onAccessibilityEvent(AccessibilityEvent(AccessibilityEvent.TYPE_WINDOWS_CHANGED).apply {
            ReflectionHelpers.setField(this, "mWindowChangeTypes", AccessibilityEvent.WINDOWS_CHANGE_PIP)
        })
        assertEquals("the floating app is the video app", video, ReflectionHelpers.getField<String?>(service, "pinnedApp"))
        assertEquals(0, homeActions())

        service.getSharedPreferences("plainphone_light", Context.MODE_PRIVATE).edit()
            .putStringSet("blocked", setOf(game, video)).apply()
        // The next window-list change, after Home's own windows settled (the guard's plan watch is not connected here).
        front(launcher)
        service.onAccessibilityEvent(AccessibilityEvent(AccessibilityEvent.TYPE_WINDOWS_CHANGED).apply {
            ReflectionHelpers.setField(this, "mWindowChangeTypes", AccessibilityEvent.WINDOWS_CHANGE_PIP)
        })
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(1))
        // Its System UI root takes no dismiss, so the app is expanded and covered by the stop screen
        // without a Home press (see guardPip).
        val stop = shadowOf(service.application).nextStartedActivity
        assertTrue("stop screen for $video: $stop", stop?.component?.className == BlockedActivity::class.java.name)
        assertEquals(video, stop?.getStringExtra("package"))
    }

    @Test fun `an app the new rules block is stopped at once, also while it floats in picture-in-picture`() {
        val video = "com.example.video"
        shadow.root = AccessibilityNodeInfo().apply { packageName = "com.android.launcher3" }
        shadow.windowList = listOf(AccessibilityWindowInfo().also {
            Shadow.extract<GuardServiceTest.WindowShadow>(it).apply {
                rootNode = AccessibilityNodeInfo().apply { packageName = video }
                pip = true
            }
        })
        ReflectionHelpers.callInstanceMethod<Unit>(service, "onServiceConnected")
        val looper = shadowOf(android.os.Looper.getMainLooper())
        looper.idleFor(Duration.ofSeconds(1))
        assertEquals("allowed while the old rules hold", 0, homeActions())

        // A sync saves the new plan; no window changes, and the guard's next tick is 30 s away.
        service.getSharedPreferences("plainphone_light", Context.MODE_PRIVATE).edit()
            .putStringSet("blocked", setOf(game, video)).apply()
        looper.idleFor(Duration.ofSeconds(1))
        assertEquals("the floating app is stopped without waiting for the tick", 1, homeActions())
        val stop = shadowOf(service.application).nextStartedActivity
        assertTrue("stop screen for $video: $stop", stop?.component?.className == BlockedActivity::class.java.name)
    }
}
