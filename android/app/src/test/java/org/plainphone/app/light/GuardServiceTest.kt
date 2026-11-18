// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [GuardServiceTest.ServiceShadow::class])
class GuardServiceTest {
    @Test fun subscribesOnlyWhileGuardedPackagesAreInFront() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        assertEquals(STATE, service.serviceInfo.eventTypes)
        for (pkg in listOf(SETTINGS, "com.google.android.packageinstaller", SettingsGuard.VPN_DIALOGS)) {
            service.event(STATE, pkg)
            assertEquals(STATE or CONTENT, service.serviceInfo.eventTypes)
            service.event(STATE, "com.android.systemui")
            assertEquals(STATE or CONTENT, service.serviceInfo.eventTypes)
            service.event(STATE, service.packageName)
            assertEquals(STATE, service.serviceInfo.eventTypes)
        }
    }

    @Test fun contentBurstWalksTheTreeOnceAfterTheLastEvent() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        service.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE)
            .edit().putBoolean("complete", true).apply()
        org.robolectric.util.ReflectionHelpers.setField(service, "keywords", SettingsGuard.Keywords(
            ownDescriptions = emptyList(), appName = "Plainphone", dangerous = emptyList(), uninstall = emptyList(),
        ))
        val shadow = org.robolectric.shadow.api.Shadow.extract<ServiceShadow>(service)
        shadow.root = AccessibilityNodeInfo().apply { packageName = SETTINGS }
        service.event(STATE, SETTINGS)
        val looper = shadowOf(Looper.getMainLooper())
        repeat(20) {
            service.event(CONTENT, SETTINGS)
            looper.idleFor(Duration.ofMillis(10))
        }
        looper.idleFor(Duration.ofMillis(239))
        assertEquals(0, shadow.rootReads)
        looper.idleFor(Duration.ofMillis(1))
        assertEquals(1, shadow.rootReads)

        service.event(CONTENT, SETTINGS)
        service.event(STATE, service.packageName)
        looper.idleFor(Duration.ofMillis(250))
        assertEquals(1, shadow.rootReads)
    }

    private fun GuardService.event(type: Int, pkg: String) {
        onAccessibilityEvent(AccessibilityEvent(type).apply { packageName = pkg })
    }

    @Implements(AccessibilityService::class)
    class ServiceShadow {
        private var info = AccessibilityServiceInfo().apply { eventTypes = STATE }
        var root: AccessibilityNodeInfo? = null
        var rootReads = 0

        @Implementation fun getServiceInfo(): AccessibilityServiceInfo = info
        @Implementation fun setServiceInfo(info: AccessibilityServiceInfo) { this.info = info }
        @Implementation fun getRootInActiveWindow(): AccessibilityNodeInfo? {
            rootReads++
            return root
        }
    }

    companion object {
        private const val SETTINGS = "com.android.settings"
        private const val STATE = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        private const val CONTENT = AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
    }
}
