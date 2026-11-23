// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import java.time.Duration
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.RealObject
import org.robolectric.shadow.api.Shadow
import org.robolectric.shadows.ShadowAccessibilityNodeInfo
import org.robolectric.util.ReflectionHelpers

/**
 * Android 10 to 13 close a picture-in-picture window only through System UI's root node id, which
 * no window reports (see [PipRootNode]). Emulator run 45125434098 (API 29): the guard's dismiss was
 * refused, and starting the player to expand it added another player to the pinned task instead,
 * so the player floated over its stop screen.
 */
@RunWith(RobolectricTestRunner::class)
@Config(
    sdk = [29],
    shadows = [GuardServiceTest.ServiceShadow::class, GuardServiceTest.WindowShadow::class, PipRootDismissTest.NodeShadow::class],
)
class PipRootDismissTest {
    private val player = "org.plainphone.fixture"
    private lateinit var service: GuardService
    private lateinit var shadow: GuardServiceTest.ServiceShadow

    @Before fun setUp() {
        NodeShadow.performed.clear()
        service = Robolectric.buildService(GuardService::class.java).create().get()
        service.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE).edit().putBoolean("complete", true).apply()
        shadow = Shadow.extract(service)
        shadowOf(android.os.Looper.getMainLooper()).idleFor(Duration.ofSeconds(10))
    }

    /** A node as Android hands it to the service: sealed, read over [connection] from [windowId]. */
    private fun sealedNode(pkg: String, windowId: Int, connection: Int = CONNECTION) = AccessibilityNodeInfo.obtain().apply {
        packageName = pkg
        ReflectionHelpers.setField(this, "mWindowId", windowId)
        ReflectionHelpers.setField(this, "mConnectionId", connection)
        ReflectionHelpers.setField(this, "mSealed", true)
    }

    private fun window(rootPkg: String?, id: Int, pip: Boolean = true) = AccessibilityWindowInfo.obtain().also {
        Shadow.extract<GuardServiceTest.WindowShadow>(it).apply {
            rootNode = rootPkg?.let { p -> sealedNode(p, id).also { root -> shadowOf(root).setOnPerformActionListener { _, _ -> false } } }
            this.pip = pip
            windowId = id
        }
    }

    private fun windowsChanged() = service.onAccessibilityEvent(AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOWS_CHANGED))

    @Config(sdk = [29, 30, 31, 32, 33])
    @Test fun `the root node is built over the service's own connection`() {
        assertEquals(CONNECTION, PipRootNode.connectionId(sealedNode(service.packageName, 4)))
        val root = PipRootNode.of(12, CONNECTION)
        assertNotNull(root)
        assertEquals(12, root!!.windowId)
        assertEquals(PipRootNode.ROOT_NODE_ID, ReflectionHelpers.getField<Long>(root, "mSourceNodeId"))
        assertEquals(CONNECTION, ReflectionHelpers.getField<Int>(root, "mConnectionId"))
        assertEquals("not a node read by a service", null, PipRootNode.connectionId(AccessibilityNodeInfo.obtain()))
    }

    @Test fun `Android 10 closes the blocked player through System UI instead of starting it again`() {
        val launcher = android.content.ComponentName(player, "$player.PlayerActivity")
        shadowOf(service.packageManager).apply {
            addActivityIfNotPresent(launcher)
            addIntentFilterForActivity(launcher, android.content.IntentFilter(android.content.Intent.ACTION_MAIN).apply {
                addCategory(android.content.Intent.CATEGORY_LAUNCHER)
            })
        }
        // The stop screen in front, as in the run.
        shadow.root = sealedNode(service.packageName, 4)
        ReflectionHelpers.callInstanceMethod<Unit>(service, "onServiceConnected") // watches the plan
        // The player, allowed, in front in window 9, enters picture-in-picture: first "null#9@1",
        // then only System UI's menu, "com.android.systemui#12@1".
        service.onAccessibilityEvent(AccessibilityEvent.obtain(AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED).apply {
            packageName = player
            ReflectionHelpers.setField(this, "mSourceWindowId", 9)
        })
        shadow.windowList = listOf(window(player, 9, pip = false))
        windowsChanged()
        shadow.windowList = listOf(window(null, 9))
        windowsChanged()
        shadow.windowList = listOf(window(PipGuard.SYSTEM_UI, 12))
        windowsChanged()
        val looper = shadowOf(android.os.Looper.getMainLooper())
        looper.idleFor(Duration.ofSeconds(2))
        assertEquals(null, shadowOf(service.application).nextStartedActivity)

        // The parent blocks the player.
        service.getSharedPreferences("plainphone_light", Context.MODE_PRIVATE).edit().putStringSet("blocked", setOf(player)).commit()
        looper.idleFor(Duration.ofSeconds(2))

        assertEquals(
            "a dismiss on System UI's root node of the pinned window",
            listOf(Triple(PipRootNode.ROOT_NODE_ID, 12, AccessibilityNodeInfo.ACTION_DISMISS)),
            NodeShadow.performed.filter { it.first == PipRootNode.ROOT_NODE_ID }.distinct(),
        )
        val starts = generateSequence { shadowOf(service.application).nextStartedActivity }.toList()
        assertFalse("starting the pinned player adds another player to the pinned task", starts.any { it.component?.packageName == player })
        assertEquals("stopped once", 1, starts.count { it.component?.className == BlockedActivity::class.java.name })
    }

    @Config(sdk = [34])
    @Test fun `Android 14 does not get a built node`() {
        assertFalse(PipRootNode.supported)
    }

    /** Records which node every action went to: its source id and window. */
    @Implements(AccessibilityNodeInfo::class)
    class NodeShadow : ShadowAccessibilityNodeInfo() {
        @RealObject private lateinit var real: AccessibilityNodeInfo

        @Implementation override fun performAction(action: Int): Boolean = performAction(action, null)

        @Implementation override fun performAction(action: Int, arguments: Bundle?): Boolean {
            performed += Triple(ReflectionHelpers.getField<Long>(real, "mSourceNodeId"), real.windowId, action)
            return super.performAction(action, arguments)
        }

        companion object {
            val performed = mutableListOf<Triple<Long, Int, Int>>()
        }
    }

    private companion object {
        const val CONNECTION = 7
    }
}
