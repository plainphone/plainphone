// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.accessibilityservice.AccessibilityService
import android.content.Context
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadow.api.Shadow
import org.robolectric.util.ReflectionHelpers

/** Moments where a blocked app could stay in front: a block that was rate-limited, and a guard that restarts. */
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
}
