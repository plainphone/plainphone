// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityWindowInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PlainphoneAdminReceiver
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadow.api.Shadow
import org.robolectric.util.ReflectionHelpers
import java.time.Duration

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34], shadows = [GuardServiceTest.ServiceShadow::class, GuardServiceTest.WindowShadow::class])
class GuardServiceTest {
    @Test fun unsubscribesOnlyWhenAllWindowsHaveKnownUnprotectedPackages() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        assertEquals(WINDOW_EVENTS, service.serviceInfo.eventTypes)
        for (pkg in listOf(SETTINGS, "com.google.android.packageinstaller", SettingsGuard.VPN_DIALOGS)) {
            shadow.windowList = emptyList()
            shadow.root = AccessibilityNodeInfo().apply { packageName = pkg }
            service.event(STATE, pkg)
            assertEquals(WINDOW_EVENTS or CONTENT, service.serviceInfo.eventTypes)
            service.event(STATE, "com.android.systemui")
            assertEquals(WINDOW_EVENTS or CONTENT, service.serviceInfo.eventTypes)
            shadow.root = AccessibilityNodeInfo().apply { packageName = service.packageName }
            service.event(STATE, service.packageName)
            assertEquals(WINDOW_EVENTS or CONTENT, service.serviceInfo.eventTypes)
            shadow.windowList = listOf(window(service.packageName), window(null))
            service.event(WINDOWS, null)
            assertEquals(WINDOW_EVENTS or CONTENT, service.serviceInfo.eventTypes)
            shadow.windowList = listOf(window(service.packageName))
            service.event(WINDOWS, null)
            assertEquals(WINDOW_EVENTS, service.serviceInfo.eventTypes)
        }
    }

    @Test fun resumesSettingsChecksAfterMaintenanceWithoutAWindowChange() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        val prefs = service.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE)
        prefs.edit().putLong("relock_at_wall", Long.MAX_VALUE).apply()

        service.event(STATE, SETTINGS)
        service.event(CONTENT, SETTINGS)
        val looper = shadowOf(Looper.getMainLooper())
        looper.idleFor(Duration.ofMillis(250))
        assertEquals(0, shadow.rootReads)
        assertEquals(WINDOW_EVENTS or CONTENT, service.serviceInfo.eventTypes)

        prefs.edit().remove("relock_at_wall").apply()
        service.event(CONTENT, SETTINGS)
        looper.idleFor(Duration.ofMillis(250))
        assertEquals(1, shadow.rootReads)
    }

    @Config(sdk = [31, 34])
    @Test fun closesActiveVpnDialogImmediatelyWithOneRootLookup() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        shadow.root = AccessibilityNodeInfo().apply { packageName = SettingsGuard.VPN_DIALOGS }

        service.event(STATE, SettingsGuard.VPN_DIALOGS)

        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
        assertEquals(1, shadow.rootReads)
        val supportsPrefetchFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
        assertEquals(if (supportsPrefetchFlags) listOf(0) else emptyList(), shadow.prefetchFlags)
        assertEquals(emptyList<Boolean>(), shadow.cacheSettings)

        // A queued content event can arrive after the dialog has already closed.
        shadow.root = null
        service.event(CONTENT, SettingsGuard.VPN_DIALOGS)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(250))
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
    }

    @Test fun ignoresQueuedVpnWindowEventAfterTheActivePackageChanges() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        shadow.root = AccessibilityNodeInfo().apply { packageName = service.packageName }

        service.event(STATE, SettingsGuard.VPN_DIALOGS)

        assertEquals(emptyList<Int>(), shadow.globalActions)
    }

    @Test fun checksWindowsImmediatelyAndContentWithin150msOfFirstEvent() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        service.event(STATE, SETTINGS)
        assertEquals(1, shadow.rootReads)

        val looper = shadowOf(Looper.getMainLooper())
        repeat(20) { index ->
            service.event(CONTENT, SETTINGS)
            looper.idleFor(Duration.ofMillis(10))
            if (index == 14) assertEquals(2, shadow.rootReads)
        }
        looper.idleFor(Duration.ofMillis(100))
        assertEquals(3, shadow.rootReads)
    }

    @Test fun keyboardAndBubbleWindowEventsKeepSettingsChecksEnabled() {
        for (overlay in listOf("com.samsung.android.honeyboard", "example.bubble")) {
            val service = Robolectric.buildService(GuardService::class.java).create().get()
            val shadow = prepareGuard(service)
            service.event(STATE, SETTINGS)
            service.event(CONTENT, SETTINGS)
            shadow.root = AccessibilityNodeInfo().apply {
                packageName = SETTINGS
                text = "Force stop Plainphone"
            }
            service.event(STATE, overlay)
            assertEquals(WINDOW_EVENTS or CONTENT, service.serviceInfo.eventTypes)
            assertEquals(emptyList<Int>(), shadow.globalActions)

            val looper = shadowOf(Looper.getMainLooper())
            looper.idleFor(Duration.ofMillis(150))
            assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)

            looper.idleFor(Duration.ofMillis(150))
            service.event(CONTENT, SETTINGS)
            looper.idleFor(Duration.ofMillis(150))
            assertEquals(List(2) { AccessibilityService.GLOBAL_ACTION_BACK }, shadow.globalActions)
        }
    }

    @Test fun waitsForMatchingSettingsRootBeforeEvaluatingTexts() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        shadow.root = AccessibilityNodeInfo().apply {
            packageName = service.packageName
            text = "Force stop Plainphone"
        }
        service.event(STATE, SETTINGS)
        assertEquals(emptyList<Int>(), shadow.globalActions)

        shadow.root = protectedSettingsRoot()
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(150))
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
    }

    @Test fun retriesVpnAtFixedDeadlinesWhenTheActiveWindowLags() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        val looper = shadowOf(Looper.getMainLooper())
        service.event(STATE, SettingsGuard.VPN_DIALOGS)
        looper.idleFor(Duration.ofMillis(49))
        assertEquals(1, shadow.rootReads)
        looper.idleFor(Duration.ofMillis(1))
        assertEquals(2, shadow.rootReads)
        service.event(STATE, SettingsGuard.VPN_DIALOGS)
        looper.idleFor(Duration.ofMillis(100))
        assertEquals(4, shadow.rootReads)
        shadow.root = AccessibilityNodeInfo().apply { packageName = SettingsGuard.VPN_DIALOGS }
        looper.idleFor(Duration.ofMillis(149))
        assertEquals(emptyList<Int>(), shadow.globalActions)
        looper.idleFor(Duration.ofMillis(1))
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
        looper.idleFor(Duration.ofMillis(400))
        assertEquals(5, shadow.rootReads)
    }

    @Test fun sendsBackOnlyOnceForSettingsAndInstallerContentInTheSameBatch() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        val installer = "com.google.android.packageinstaller"
        shadow.root = AccessibilityNodeInfo().apply {
            packageName = installer
            text = "Uninstall Plainphone"
        }

        service.event(CONTENT, SETTINGS)
        service.event(CONTENT, installer)
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(150))

        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
        assertEquals(1, shadow.rootReads)
    }

    @Test fun keepsVpnRetriesWhenAndroidRejectsBack() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        val looper = shadowOf(Looper.getMainLooper())
        service.event(STATE, SettingsGuard.VPN_DIALOGS)
        shadow.root = AccessibilityNodeInfo().apply { packageName = SettingsGuard.VPN_DIALOGS }
        shadow.acceptGlobalAction = false

        looper.idleFor(Duration.ofMillis(50))
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)

        shadow.acceptGlobalAction = true
        looper.idleFor(Duration.ofMillis(100))
        assertEquals(List(2) { AccessibilityService.GLOBAL_ACTION_BACK }, shadow.globalActions)
        looper.idleFor(Duration.ofMillis(150))
        assertEquals(3, shadow.rootReads)
    }

    @Test fun checksAgainWhenTheSettingsRootLagsBehindTheWindowEvent() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        service.event(STATE, SETTINGS)
        shadow.root = protectedSettingsRoot()

        val looper = shadowOf(Looper.getMainLooper())
        looper.idleFor(Duration.ofMillis(149))
        assertEquals(emptyList<Int>(), shadow.globalActions)
        looper.idleFor(Duration.ofMillis(1))
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
    }

    @Test fun keepsWatchingSplitScreenSettingsAndChecksWhenFocusReturns() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        service.event(STATE, SETTINGS)
        val looper = shadowOf(Looper.getMainLooper())
        looper.idleFor(Duration.ofMillis(150))

        shadow.root = AccessibilityNodeInfo().apply { packageName = service.packageName }
        shadow.windowList = listOf(window(SETTINGS), window(service.packageName, focused = true))
        service.event(STATE, service.packageName)
        assertEquals(WINDOW_EVENTS or CONTENT, service.serviceInfo.eventTypes)

        shadow.windowList = listOf(window(SETTINGS, focused = true), window(service.packageName))
        service.event(WINDOWS, null, AccessibilityEvent.WINDOWS_CHANGE_FOCUSED)
        shadow.root = protectedSettingsRoot()
        looper.idleFor(Duration.ofMillis(150))
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
    }

    @Test fun checksNewProtectedWindowAfterSuccessfulBack() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        val looper = shadowOf(Looper.getMainLooper())
        shadow.root = protectedSettingsRoot()
        service.event(STATE, SETTINGS)
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)

        looper.idleFor(Duration.ofMillis(30))
        shadow.root = null
        service.event(STATE, SETTINGS)
        shadow.root = protectedSettingsRoot()
        looper.idleFor(Duration.ofMillis(150))

        assertEquals(List(2) { AccessibilityService.GLOBAL_ACTION_BACK }, shadow.globalActions)
    }

    @Test fun checksFocusedWindowWhenItsRootBecomesReadable() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        shadow.windowList = listOf(window(null, focused = true, id = 42), window(service.packageName))
        shadow.root = null
        service.event(WINDOWS, null, AccessibilityEvent.WINDOWS_CHANGE_FOCUSED)
        assertEquals(WINDOW_EVENTS or CONTENT, service.serviceInfo.eventTypes)

        shadow.root = protectedSettingsRoot().also { ReflectionHelpers.setField(it, "mWindowId", 42) }
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(150))

        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
    }

    @Test fun ignoresSettingsFocusCheckAfterAnotherAppBecomesActive() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        shadow.windowList = listOf(window(SETTINGS, focused = true), window(service.packageName))
        service.event(WINDOWS, null, AccessibilityEvent.WINDOWS_CHANGE_FOCUSED)
        shadow.root = protectedSettingsRoot().apply { packageName = service.packageName }
        shadowOf(Looper.getMainLooper()).idleFor(Duration.ofMillis(150))

        assertEquals(emptyList<Int>(), shadow.globalActions)
    }

    @Test fun closesVpnAtOneSecondWithoutResettingTheRetrySchedule() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        val looper = shadowOf(Looper.getMainLooper())
        service.event(STATE, SettingsGuard.VPN_DIALOGS)
        looper.idleFor(Duration.ofMillis(600))
        assertEquals(5, shadow.rootReads)

        looper.idleFor(Duration.ofMillis(200))
        service.event(STATE, SettingsGuard.VPN_DIALOGS)
        looper.idleFor(Duration.ofMillis(199))
        assertEquals(6, shadow.rootReads)
        shadow.root = AccessibilityNodeInfo().apply { packageName = SettingsGuard.VPN_DIALOGS }
        looper.idleFor(Duration.ofMillis(1))
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
    }

    @Test fun suppressesDuplicateSettingsBackButLetsVpnRetrySendBack() {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        val shadow = prepareGuard(service)
        val looper = shadowOf(Looper.getMainLooper())
        shadow.root = protectedSettingsRoot()
        service.event(CONTENT, SETTINGS)
        service.event(STATE, SETTINGS)
        looper.idleFor(Duration.ofMillis(150))
        assertEquals(listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)

        service.event(STATE, SettingsGuard.VPN_DIALOGS)
        shadow.root = AccessibilityNodeInfo().apply { packageName = SettingsGuard.VPN_DIALOGS }
        looper.idleFor(Duration.ofMillis(50))
        assertEquals(List(2) { AccessibilityService.GLOBAL_ACTION_BACK }, shadow.globalActions)
    }

    @Test fun vpnDialogStillGetsItsBackWhenSettingsTakesTheBackInTheSameBatch() {
        for (vpnFirst in listOf(true, false)) {
            val service = Robolectric.buildService(GuardService::class.java).create().get()
            val shadow = prepareGuard(service)
            val looper = shadowOf(Looper.getMainLooper())
            shadow.root = protectedSettingsRoot()

            if (vpnFirst) service.event(STATE, SettingsGuard.VPN_DIALOGS)
            service.event(STATE, SETTINGS)
            if (!vpnFirst) service.event(STATE, SettingsGuard.VPN_DIALOGS)

            // The Settings text rule takes the one Back of this batch, the VPN dialog is not forgotten.
            assertEquals("vpnFirst=$vpnFirst", listOf(AccessibilityService.GLOBAL_ACTION_BACK), shadow.globalActions)
            val handler = ReflectionHelpers.getField<Handler>(service, "main")
            assertTrue(handler.hasCallbacks(ReflectionHelpers.getField<Runnable>(service, "vpnRetry")))

            shadow.root = AccessibilityNodeInfo().apply { packageName = SettingsGuard.VPN_DIALOGS }
            looper.idleFor(Duration.ofMillis(50))
            assertEquals("vpnFirst=$vpnFirst", List(2) { AccessibilityService.GLOBAL_ACTION_BACK }, shadow.globalActions)
        }
    }

    @Test fun maintenanceCancelsBothPendingChecks() = assertCancelsBothPendingChecks { service ->
        service.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE)
            .edit().putLong("relock_at_wall", Long.MAX_VALUE).apply()
    }

    @Test fun strongModeCancelsBothPendingChecks() = assertCancelsBothPendingChecks { service ->
        val dpm = shadowOf(service.getSystemService(DevicePolicyManager::class.java))
        val admin = PlainphoneAdminReceiver.component(service)
        dpm.setActiveAdmin(admin)
        assertTrue(dpm.setDeviceOwner(admin))
    }

    private fun assertCancelsBothPendingChecks(enterMode: (GuardService) -> Unit) {
        val service = Robolectric.buildService(GuardService::class.java).create().get()
        prepareGuard(service)
        service.event(STATE, SettingsGuard.VPN_DIALOGS)
        service.event(CONTENT, SETTINGS)
        val handler = ReflectionHelpers.getField<Handler>(service, "main")
        val vpnRetry = ReflectionHelpers.getField<Runnable>(service, "vpnRetry")
        val settingsCheck = ReflectionHelpers.getField<Runnable>(service, "settingsCheck")
        assertTrue(handler.hasCallbacks(vpnRetry))
        assertTrue(handler.hasCallbacks(settingsCheck))

        enterMode(service)
        service.event(WINDOWS, null)

        assertFalse(handler.hasCallbacks(vpnRetry))
        assertFalse(handler.hasCallbacks(settingsCheck))
    }

    private fun protectedSettingsRoot() = AccessibilityNodeInfo().apply {
        packageName = SETTINGS
        text = "Force stop Plainphone"
    }

    private fun window(pkg: String?, focused: Boolean = false, id: Int = 1) =
        AccessibilityWindowInfo().also {
            val shadow = Shadow.extract<WindowShadow>(it)
            shadow.rootNode = pkg?.let { AccessibilityNodeInfo().apply { packageName = pkg } }
            shadow.focused = focused
            shadow.windowId = id
        }

    @Implements(AccessibilityWindowInfo::class)
    class WindowShadow {
        var rootNode: AccessibilityNodeInfo? = null
        var focused = false
        var windowId = 1
        var pip = false

        @Implementation fun isInPictureInPictureMode(): Boolean = pip
        @Implementation fun getRoot(): AccessibilityNodeInfo? = rootNode
        @Implementation(minSdk = 33) fun getRoot(prefetchingStrategy: Int): AccessibilityNodeInfo? = rootNode
        @Implementation fun isFocused(): Boolean = focused
        @Implementation fun getId(): Int = windowId
        /** Before Android 13 the guard recycles each window it read; the tests hand out the same ones again. */
        @Implementation fun recycle() {}
    }

    private fun prepareGuard(service: GuardService): ServiceShadow {
        service.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE)
            .edit().putBoolean("complete", true).apply()
        ReflectionHelpers.setField(service, "keywords", SettingsGuard.Keywords(
            ownDescriptions = emptyList(), appName = "Plainphone", dangerous = listOf("force stop", "uninstall"),
        ))
        val shadow = Shadow.extract<ServiceShadow>(service)
        shadow.root = AccessibilityNodeInfo().apply { packageName = SETTINGS }
        return shadow
    }

    private fun GuardService.event(type: Int, pkg: String?, changes: Int = 0) {
        onAccessibilityEvent(AccessibilityEvent(type).apply {
            packageName = pkg
            ReflectionHelpers.setField(this, "mWindowChangeTypes", changes)
        })
    }

    @Implements(AccessibilityService::class)
    class ServiceShadow {
        private var submittedEventTypes = WINDOW_EVENTS
        var windowList = emptyList<AccessibilityWindowInfo>()

        @Implementation fun getWindows(): List<AccessibilityWindowInfo> = windowList
        var root: AccessibilityNodeInfo? = null
        var rootReads = 0
        var acceptGlobalAction = true

        val prefetchFlags = mutableListOf<Int>()
        val globalActions = mutableListOf<Int>()
        val cacheSettings = mutableListOf<Boolean>()

        @Implementation fun getServiceInfo(): AccessibilityServiceInfo =
            AccessibilityServiceInfo().apply { eventTypes = submittedEventTypes }

        @Implementation fun setServiceInfo(info: AccessibilityServiceInfo) {
            submittedEventTypes = info.eventTypes
        }

        @Implementation fun performGlobalAction(action: Int): Boolean {
            globalActions += action
            return acceptGlobalAction
        }

        @Implementation fun setCacheEnabled(enabled: Boolean): Boolean {
            cacheSettings += enabled
            return true
        }

        @Implementation(minSdk = 33)
        fun getRootInActiveWindow(prefetchingStrategy: Int): AccessibilityNodeInfo? {
            prefetchFlags += prefetchingStrategy
            return getRootInActiveWindow()
        }

        @Implementation fun getRootInActiveWindow(): AccessibilityNodeInfo? {
            rootReads++
            return root
        }
    }

    companion object {
        private const val SETTINGS = "com.android.settings"
        private const val STATE = AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        private const val WINDOWS = AccessibilityEvent.TYPE_WINDOWS_CHANGED
        private const val WINDOW_EVENTS = STATE or WINDOWS
        private const val CONTENT = AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
    }
}
