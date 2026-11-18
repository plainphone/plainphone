// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import org.plainphone.app.Lock
import org.plainphone.app.R
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.time.TimeGuard

/**
 * Light mode's enforcer. Android tells an accessibility service which app is in front; when it is
 * one the parent has not allowed, or its time is used up, Plainphone goes home and shows its own
 * calm screen instead. It also closes the Settings screens that would switch Plainphone off.
 *
 * Strong mode does not need it (apps are hidden or suspended there), so it does nothing then.
 */
class GuardService : AccessibilityService() {
    private val main = Handler(Looper.getMainLooper())
    private val worker = java.util.concurrent.Executors.newSingleThreadExecutor()
    private var foreground: String? = null
    private var watchingContent = false
    private var lastBlockAt = 0L
    private var lastTimeCheck = 0L
    private var keywords: SettingsGuard.Keywords? = null
    private var screenReceiver: BroadcastReceiver? = null

    private val pendingSettingsPackages = mutableSetOf<String>()
    private val pendingSettingsWindowIds = mutableSetOf<Int>()
    private val settingsCheck = Runnable {
        val packages = pendingSettingsPackages.toSet()
        val windowIds = pendingSettingsWindowIds.toSet()
        clearSettingsCheck()
        if (canGuardSettings()) guardSettings(packages, windowIds)
    }
    private val vpnRetry = Runnable {
        if (canGuardSettings()) closeVpnDialog()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!isInteractive()) return
            foreground?.let { checkTime(it, force = true) }
            main.postDelayed(this, TICK_MS)
        }
    }

    override fun onServiceConnected() {
        if (LightRelease.isReleased(this)) {
            disableSelf()
            return
        }
        isConnected = true
        instance = java.lang.ref.WeakReference(this)
        Log.i(TAG, "guard connected")
        Lock.recoverInstallAsync(this, "guard connected", force = true)
        keywords = buildKeywords()
        screenReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                main.removeCallbacks(tick)
                if (intent.action == Intent.ACTION_SCREEN_ON && isInteractive()) main.postDelayed(tick, TICK_MS)
            }
        }.also {
            registerReceiver(it, IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) })
        }
        if (isInteractive()) main.postDelayed(tick, TICK_MS)
        protectionChanged("accessibility on")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val e = event ?: return
        if (Mode.isStrong(this) || LightRelease.isReleased(this)) {
            cancelSettingsChecks()
            updateEventTypes(watchContent = false)
            return
        }

        val maintenance = Lock.isInMaintenanceWindow(this)
        if (maintenance) cancelSettingsChecks()

        if (e.eventType == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            val changes = e.windowChanges
            if (changes == 0 || (changes and WINDOW_INVENTORY_CHANGES) != 0) {
                updateWindowSubscription(focusChanges = if (maintenance) 0 else changes)
            }
            return
        }

        val pkg = e.packageName?.toString() ?: return
        val windowChanged = e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        val guarded = guardsSettings(pkg)
        if (windowChanged) {
            if (!isOverlay(pkg)) foreground = pkg
            // Keep tracking windows during maintenance so checks can resume in place.
            if (guarded) updateEventTypes(watchContent = true) else updateWindowSubscription()
        }
        if (maintenance) return

        when {
            guarded && windowChanged && pkg == SettingsGuard.VPN_DIALOGS -> {
                if (LightSetup.isComplete(this) && !closeVpnDialog() && !main.hasCallbacks(vpnRetry)) {
                    VPN_RETRY_DELAYS_MS.forEach { main.postDelayed(vpnRetry, it) }
                }
            }
            guarded && windowChanged -> {
                // During setup the user needs access to the protected screens.
                if (LightSetup.isComplete(this)) {
                    // The active root can still belong to the previous screen.
                    scheduleSettingsCheck(pkg)
                    guardSettings(setOf(pkg))
                }
            }
            // Settings can swap fragments without changing windows.
            guarded && e.eventType == AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED -> scheduleSettingsCheck(pkg)
            windowChanged -> guard(pkg)
        }
    }

    private fun guardsSettings(pkg: String) =
        pkg in SettingsGuard.SETTINGS_PACKAGES ||
            pkg in SettingsGuard.INSTALLER_PACKAGES ||
            pkg == SettingsGuard.VPN_DIALOGS

    @Suppress("DEPRECATION")
    private fun updateWindowSubscription(focusChanges: Int = 0) {
        val visibleWindows = windows
        var watchContent = visibleWindows.isEmpty()
        for (window in visibleWindows) {
            try {
                val root = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    window.getRoot(0)
                } else {
                    window.root
                }
                val pkg = root?.packageName?.toString()
                root?.let(::recycle)
                if (pkg != null && !guardsSettings(pkg)) continue
                watchContent = true
                val gainedFocus = (focusChanges and AccessibilityEvent.WINDOWS_CHANGE_FOCUSED) != 0 &&
                    window.isFocused
                val becameActive = (focusChanges and AccessibilityEvent.WINDOWS_CHANGE_ACTIVE) != 0 &&
                    window.isActive
                if (gainedFocus || becameActive) {
                    if (pkg == null) {
                        pendingSettingsWindowIds.add(window.id)
                        scheduleSettingsCheck()
                    } else {
                        scheduleSettingsCheck(pkg)
                    }
                }
            } finally {
                if (Build.VERSION.SDK_INT < 33) window.recycle()
            }
        }
        updateEventTypes(watchContent)
    }

    private fun updateEventTypes(watchContent: Boolean) {
        if (watchingContent == watchContent) return
        val info = serviceInfo ?: return
        info.eventTypes = if (watchContent) {
            WINDOW_EVENTS or AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED
        } else {
            WINDOW_EVENTS
        }
        setServiceInfo(info)
        watchingContent = watchContent
    }

    private fun scheduleSettingsCheck(pkg: String? = null) {
        if (pkg != null) pendingSettingsPackages.add(pkg)
        if (!main.hasCallbacks(settingsCheck)) main.postDelayed(settingsCheck, SETTINGS_MAX_WAIT_MS)
    }

    private fun clearSettingsCheck() {
        main.removeCallbacks(settingsCheck)
        pendingSettingsPackages.clear()
        pendingSettingsWindowIds.clear()
    }

    private fun cancelSettingsChecks() {
        clearSettingsCheck()
        main.removeCallbacks(vpnRetry)
    }

    private fun canGuardSettings() =
        !Mode.isStrong(this) && !LightRelease.isReleased(this) && !Lock.isInMaintenanceWindow(this) && LightSetup.isComplete(this)

    private fun isInteractive(): Boolean =
        getSystemService(PowerManager::class.java)?.isInteractive == true

    private fun guard(pkg: String) {
        if (pkg == packageName) return
        when (LightLock.plan(this).why(pkg)) {
            LightPlan.Why.NOT_ALLOWED -> block(pkg, BlockedActivity.Reason.NOT_ALLOWED)
            LightPlan.Why.TIME_USED_UP -> block(pkg, BlockedActivity.Reason.TIME_USED_UP)
            null -> checkTime(pkg, force = false)
        }
    }

    private fun guardSettings(packages: Set<String>, windowIds: Set<Int> = emptySet()) {
        val root = if (packages.size == 1 && SettingsGuard.VPN_DIALOGS in packages && windowIds.isEmpty()) {
            activeRootWithoutPrefetch()
        } else {
            rootInActiveWindow
        } ?: return
        val pkg = root.packageName?.toString()
        if (pkg == null || (pkg !in packages && (root.windowId !in windowIds || !guardsSettings(pkg)))) {
            recycle(root)
            return
        }
        if (pkg == SettingsGuard.VPN_DIALOGS) {
            recycle(root)
            dismissVpnDialog()
            return
        }
        val k = keywords
        if (k == null) {
            recycle(root)
            return
        }
        val texts = ArrayList<String>()
        collect(root, texts, depth = 0)
        if (!SettingsGuard.isProtectedScreen(pkg, texts, k)) return
        if (performGlobalAction(GLOBAL_ACTION_BACK)) clearSettingsCheck()
        block(pkg, BlockedActivity.Reason.PROTECTION)
    }

    private fun activeRootWithoutPrefetch() =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) getRootInActiveWindow(0) else rootInActiveWindow

    private fun closeVpnDialog(): Boolean {
        val root = activeRootWithoutPrefetch() ?: return false
        val matchesPackage = root.packageName?.toString() == SettingsGuard.VPN_DIALOGS
        recycle(root)
        return matchesPackage && dismissVpnDialog()
    }

    private fun dismissVpnDialog(): Boolean {
        if (!performGlobalAction(GLOBAL_ACTION_BACK)) return false
        main.removeCallbacks(vpnRetry)
        block(SettingsGuard.VPN_DIALOGS, BlockedActivity.Reason.PROTECTION)
        return true
    }

    /** Time limits: re-evaluated when an app comes to the front and every [TICK_MS] while it stays there. */
    private fun checkTime(pkg: String, force: Boolean) {
        if (LightRelease.isReleased(this) || pkg == packageName || isOverlay(pkg)) return
        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastTimeCheck < 5_000L) return
        lastTimeCheck = now
        if (worker.isShutdown || Lock.isInMaintenanceWindow(this)) return
        // Reading a day of usage events is slow; this process also shows the in-call screen.
        runCatching { worker.execute {
            val snap = runCatching { TimeGuard.snapshot(this) }.getOrNull() ?: return@execute
            if (pkg !in snap.blocked) return@execute
            main.post {
                if (foreground != pkg) return@post
                block(pkg, BlockedActivity.Reason.TIME_USED_UP)
                // Refresh the stored plan and tell the parent the minutes used.
                Lock.applyAsync(this, "time used up")
            }
        } } // a shutdown racing this call is ignored: the guard is going away

    }

    private fun block(pkg: String, reason: BlockedActivity.Reason) {
        if (LightRelease.isReleased(this)) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastBlockAt < 700L) return
        lastBlockAt = now
        if (reason != BlockedActivity.Reason.PROTECTION) performGlobalAction(GLOBAL_ACTION_HOME)
        runCatching { startActivity(BlockedActivity.intent(this, pkg, reason)) }
            .onFailure { Log.w(TAG, "could not show the blocked screen: ${it.message}") }
    }

    private fun collect(node: AccessibilityNodeInfo, out: MutableList<String>, depth: Int) {
        try {
            if (depth > 25 || out.size > 400) return
            node.text?.let { out += it.toString() }
            node.contentDescription?.let { out += it.toString() }
            for (i in 0 until node.childCount) node.getChild(i)?.let { collect(it, out, depth + 1) }
        } finally {
            recycle(node)
        }
    }

    @Suppress("DEPRECATION")
    private fun recycle(node: AccessibilityNodeInfo) {
        if (Build.VERSION.SDK_INT < 33) node.recycle()
    }

    /** The shade, the keyboard and the launcher are not "an app in front". */
    private fun isOverlay(pkg: String) = pkg == "com.android.systemui" || pkg.contains("inputmethod")

    private fun buildKeywords(): SettingsGuard.Keywords {
        val fromSettings = SETTINGS_STRING_NAMES.mapNotNull { name -> settingsString(name) }
        return SettingsGuard.Keywords(
            ownDescriptions = listOf(getString(R.string.guard_description), getString(R.string.light_admin_description)),
            appName = getString(R.string.app_name),
            dangerous = (SettingsGuard.Keywords.BUILT_IN + fromSettings.map { it.lowercase() }).distinct(),
            uninstall = (SettingsGuard.Keywords.UNINSTALL + listOfNotNull(settingsString("uninstall_text")).map { it.lowercase() }).distinct(),
        )
    }

    /** A string from the phone's own Settings app, in the phone's language. Missing names are skipped. */
    private fun settingsString(name: String): String? = runCatching {
        val res = packageManager.getResourcesForApplication("com.android.settings")
        @Suppress("DiscouragedApi") // Reading another app's strings by name is the only way to get its translations.
        val id = res.getIdentifier(name, "string", "com.android.settings")
        if (id == 0) null else res.getString(id).trim().takeIf { it.length in 3..40 }
    }.getOrNull()

    override fun onInterrupt() = Unit

    override fun onUnbind(intent: Intent?): Boolean {
        teardown("accessibility off")
        return super.onUnbind(intent)
    }

    override fun onDestroy() {
        teardown("accessibility service stopped")
        super.onDestroy()
    }

    private fun teardown(why: String) {
        if (!isConnected) return
        isConnected = false
        main.removeCallbacks(tick)
        cancelSettingsChecks()
        screenReceiver?.let { runCatching { unregisterReceiver(it) } }
        screenReceiver = null
        worker.shutdown()
        protectionChanged(why)
    }

    /** Tell the parent at once: the status goes out with the next sync, which this starts. */
    private fun protectionChanged(why: String) {
        Log.i(TAG, "protection changed: $why")
        runCatching { SyncScheduler.now(applicationContext, why) }
    }

    companion object {
        private const val TAG = "Plainphone"
        private const val SETTINGS_MAX_WAIT_MS = 150L
        private val VPN_RETRY_DELAYS_MS = listOf(50L, 150L, 300L, 600L, 1_000L)
        private const val WINDOW_EVENTS =
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED or AccessibilityEvent.TYPE_WINDOWS_CHANGED
        private const val WINDOW_INVENTORY_CHANGES = AccessibilityEvent.WINDOWS_CHANGE_ADDED or
            AccessibilityEvent.WINDOWS_CHANGE_REMOVED or AccessibilityEvent.WINDOWS_CHANGE_FOCUSED or
            AccessibilityEvent.WINDOWS_CHANGE_ACTIVE
        private const val TICK_MS = 30_000L

        @Volatile var isConnected = false
            private set
        @Volatile private var instance: java.lang.ref.WeakReference<GuardService>? = null

        /** Maintenance: the service switches itself off (Android 7+). False when it is not running. */
        fun disable(): Boolean {
            val service = instance?.get() ?: return false
            service.disableSelf()
            return true
        }

        /** Names of AOSP Settings strings for the screens that matter, so the guard knows them in every language. */
        private val SETTINGS_STRING_NAMES = listOf(
            "uninstall_text", "force_stop", "clear_user_data_text", "disable_text",
            "vpn_menu_delete", "vpn_disconnect", "remove_device_admin", "usage_access",
        )
    }
}
