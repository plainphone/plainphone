// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.accessibilityservice.AccessibilityService
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
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
    private var lastBlockAt = 0L
    private var lastTimeCheck = 0L
    private var keywords: SettingsGuard.Keywords? = null
    private var screenReceiver: BroadcastReceiver? = null

    private val tick = object : Runnable {
        override fun run() {
            foreground?.let { checkTime(it, force = true) }
            main.postDelayed(this, TICK_MS)
        }
    }

    override fun onServiceConnected() {
        isConnected = true
        instance = java.lang.ref.WeakReference(this)
        Log.i(TAG, "guard connected")
        keywords = buildKeywords()
        screenReceiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) {
                main.removeCallbacks(tick)
                if (intent.action == Intent.ACTION_SCREEN_ON) main.postDelayed(tick, TICK_MS)
            }
        }.also {
            registerReceiver(it, IntentFilter().apply { addAction(Intent.ACTION_SCREEN_ON); addAction(Intent.ACTION_SCREEN_OFF) })
        }
        main.postDelayed(tick, TICK_MS)
        protectionChanged("accessibility on")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        val e = event ?: return
        val pkg = e.packageName?.toString() ?: return
        if (Mode.isStrong(this) || Lock.isInMaintenanceWindow(this)) return
        when (e.eventType) {
            AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED -> {
                if (pkg != foreground && !isOverlay(pkg)) foreground = pkg
                guard(pkg)
            }
            // Settings swaps fragments without a new window; look again when its content changes.
            AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED ->
                if (pkg in SettingsGuard.SETTINGS_PACKAGES || pkg in SettingsGuard.INSTALLER_PACKAGES) guardSettings(pkg)
            else -> Unit // the service only subscribes to the two types above
        }
    }

    private fun guard(pkg: String) {
        if (pkg == packageName) return
        if (pkg in SettingsGuard.SETTINGS_PACKAGES || pkg in SettingsGuard.INSTALLER_PACKAGES || pkg == SettingsGuard.VPN_DIALOGS) {
            guardSettings(pkg)
            return
        }
        when (LightLock.plan(this).why(pkg)) {
            LightPlan.Why.NOT_ALLOWED -> block(pkg, BlockedActivity.Reason.NOT_ALLOWED)
            LightPlan.Why.TIME_USED_UP -> block(pkg, BlockedActivity.Reason.TIME_USED_UP)
            null -> checkTime(pkg, force = false)
        }
    }

    private fun guardSettings(pkg: String) {
        // While setting up, the user has to visit exactly these screens.
        if (!LightSetup.isComplete(this)) return
        val k = keywords ?: return
        val root = rootInActiveWindow ?: return
        val texts = ArrayList<String>()
        collect(root, texts, depth = 0)
        if (SettingsGuard.isProtectedScreen(pkg, texts, k)) {
            performGlobalAction(GLOBAL_ACTION_BACK)
            block(pkg, BlockedActivity.Reason.PROTECTION)
        }
    }

    /** Time limits: re-evaluated when an app comes to the front and every [TICK_MS] while it stays there. */
    private fun checkTime(pkg: String, force: Boolean) {
        if (pkg == packageName || isOverlay(pkg)) return
        val now = SystemClock.elapsedRealtime()
        if (!force && now - lastTimeCheck < 5_000L) return
        lastTimeCheck = now
        // Reading a day of usage events is slow; this process also shows the in-call screen.
        worker.execute {
            val snap = runCatching { TimeGuard.snapshot(this) }.getOrNull() ?: return@execute
            if (pkg !in snap.blocked) return@execute
            main.post {
                if (foreground != pkg) return@post
                block(pkg, BlockedActivity.Reason.TIME_USED_UP)
                // Refresh the stored plan and tell the parent the minutes used.
                Lock.applyAsync(this, "time used up")
            }
        }
    }

    private fun block(pkg: String, reason: BlockedActivity.Reason) {
        val now = SystemClock.elapsedRealtime()
        if (now - lastBlockAt < 700L) return
        lastBlockAt = now
        if (reason != BlockedActivity.Reason.PROTECTION) performGlobalAction(GLOBAL_ACTION_HOME)
        runCatching { startActivity(BlockedActivity.intent(this, pkg, reason)) }
            .onFailure { Log.w(TAG, "could not show the blocked screen: ${it.message}") }
    }

    private fun collect(node: AccessibilityNodeInfo, out: MutableList<String>, depth: Int) {
        if (depth > 25 || out.size > 400) return
        node.text?.let { out += it.toString() }
        node.contentDescription?.let { out += it.toString() }
        for (i in 0 until node.childCount) node.getChild(i)?.let { collect(it, out, depth + 1) }
    }

    /** The shade, the keyboard and the launcher are not "an app in front". */
    private fun isOverlay(pkg: String) = pkg == "com.android.systemui" || pkg.contains("inputmethod")

    private fun buildKeywords(): SettingsGuard.Keywords {
        val fromSettings = SETTINGS_STRING_NAMES.mapNotNull { name -> settingsString(name) }
        return SettingsGuard.Keywords(
            ownDescriptions = listOf(getString(R.string.guard_description), getString(R.string.light_admin_description)),
            appName = getString(R.string.app_name),
            dangerous = (SettingsGuard.Keywords.BUILT_IN + fromSettings.map { it.lowercase() }).distinct(),
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
            "vpn_menu_delete", "vpn_disconnect", "remove_device_admin",
        )
    }
}
