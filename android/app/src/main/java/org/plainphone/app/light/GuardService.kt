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
import android.view.inputmethod.InputMethodManager
import org.plainphone.app.Lock
import org.plainphone.app.R
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.time.LimitWarningNotifier
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
        set(value) {
            field = value
            if (value != null && value != packageName && !isOverlay(value) && value !in homePackages()) lastApp = value
        }
    /**
     * The last app in front that was not Home, an overlay or Plainphone: the only app that can have
     * entered picture-in-picture, even when Home's window event came before the pinned window.
     */
    private var lastApp: String? = null
    private var watchingContent = false
    private var lastBlockAt = 0L
    private var lastTimeCheck = 0L
    private var lastTimeCheckPkg: String? = null
    private var lastPipTimeCheck = 0L
    private var pipPackages: List<String> = emptyList()
    /** Picture-in-picture apps already stopped once; forgotten when their window is gone. */
    private val pipStopped = mutableSetOf<String>()
    /** Picture-in-picture apps asked to return to full screen (Android 10 refuses the dismiss), by elapsed time. */
    private val pipExpandedAt = mutableMapOf<String, Long>()
    /** Picture-in-picture apps expanded for their current window; forgotten when the window is gone. */
    private val pipExpanded = mutableSetOf<String>()
    /** Re-checks done after dismissing each floating blocked app, for its current window (see [PipGuard.RECHECK_DELAYS_MS]). */
    private val pipRechecks = mutableMapOf<String, Int>()
    private var lastPipSeen = ""
    /** Window id to the app it showed, recent windows only: Android 10 pins a window before its root is readable. */
    private val windowOwners = object : LinkedHashMap<Int, String>(16, 0.75f, true) {
        override fun removeEldestEntry(eldest: MutableMap.MutableEntry<Int, String>?) = size > WINDOW_OWNERS_KEPT
    }
    /** The app last seen in picture-in-picture, while a pinned window is listed (see [PipGuard.owner]). */
    private var pinnedApp: String? = null
    /** This service's accessibility connection, read from a node once (see [PipRootNode]). */
    private var connectionId: Int? = null
    private var keywords: SettingsGuard.Keywords? = null
    private var screenReceiver: BroadcastReceiver? = null
    private var planWatch: android.content.SharedPreferences.OnSharedPreferenceChangeListener? = null

    private val pendingSettingsPackages = mutableSetOf<String>()
    private val pendingSettingsWindowIds = mutableSetOf<Int>()
    private val settingsCheck = Runnable {
        val packages = pendingSettingsPackages.toSet()
        val windowIds = pendingSettingsWindowIds.toSet()
        clearSettingsCheck()
        if (canGuardSettings()) guardSettings(packages, windowIds)
    }
    private val vpnRetry = Runnable {
        if (canGuardSettings() && guardsSettings(SettingsGuard.VPN_DIALOGS)) closeVpnDialog()
    }

    private val tick = object : Runnable {
        override fun run() {
            if (!isInteractive()) return
            // The allow-list decides again too, not only the time limits: an emergency opening that just
            // ended, or a blocked app still in front after a missed block.
            if (canGuardApps()) appInFront()?.let { guard(it, force = true) }
            if (canGuardApps()) guardPip()
            main.postDelayed(this, TICK_MS)
        }
    }

    /** After a dismiss: is the window gone? Android 10 can drop the dismiss, and no window event says so. */
    private val pipRecheck = Runnable {
        pipRechecks.replaceAll { _, done -> done + 1 }
        if (canGuardApps()) guardPip()
    }

    /** A block dropped by the rate limit: look at the app in front again once the gap is over. */
    private val reguard = Runnable {
        if (!canGuardApps()) return@Runnable
        // The live window first: a stop screen's late event can name Plainphone while the app is back.
        appInFront()?.let { guard(it, force = true) }
        guardPip()
    }

    /**
     * After a stop screen: is the blocked app still in front? Started again within moments of its
     * stop screen, its focus can come before the stop screen's own window events, so the events end
     * with Plainphone in front while the app is (emulator run 45047940235, API 34: 40 s unchecked).
     */
    private val settle = Runnable {
        if (!canGuardApps()) return@Runnable
        appInFront(live = true)?.let { guard(it) }
    }

    /** Limited emergency openings (Self phone, light mode only): one app, 15 minutes. */
    private val emergency by lazy { EmergencyOpenings.of(this) }
    private val emergencyExpiry = Runnable {
        if (emergency.isActive(foreground ?: "")) {
            scheduleEmergencyExpiry()
            return@Runnable
        }
        foreground?.takeIf { emergency.hasActiveRecord(it) }?.let { guard(it, force = true) }
        emergency.clearIfOver()
    }

    override fun onServiceConnected() {
        if (LightRelease.isReleased(this)) {
            disableSelf()
            return
        }
        isConnected = true
        connectionId = null
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
        // New rules (a sync, a used-up limit) can block the app in front or one floating in
        // picture-in-picture. No window changes then, so look now instead of at the next tick.
        planWatch = LightLock.watchPlan(this) {
            main.removeCallbacks(reguard)
            main.post(reguard)
        }
        protectionChanged("accessibility on")
        // An app opened while the guard was away (a crash, an update) is checked now, not at its next window change.
        rootInActiveWindow?.let { root ->
            val pkg = root.packageName?.toString()
            recycle(root)
            if (pkg != null && !isOverlay(pkg)) {
                foreground = pkg
                if (canGuardApps()) guard(pkg, force = true)
            }
        }
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
                val app = updateWindowSubscription(focusChanges = if (maintenance) 0 else changes)
                // A task brought back to the front (a second start of an open app) can come without a
                // window state event, so the app in front would be the stop screen it covered (API 34).
                // Checked even when it is the app last in front: that can be a stop screen's late event.
                if (app != null) {
                    foreground = app
                    if (canGuardApps()) guard(app)
                }
            }
            // An app that enters picture-in-picture only shows up here, never as "in front".
            if (!maintenance && canGuardApps()) guardPip()
            return
        }

        val pkg = e.packageName?.toString() ?: return
        val windowChanged = e.eventType == AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED
        val guarded = guardsSettings(pkg)
        if (windowChanged) {
            if (!isOverlay(pkg)) {
                foreground = pkg
                if (e.windowId >= 0) windowOwners[e.windowId] = pkg
            }
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
            (pkg == SettingsGuard.VPN_DIALOGS && LightFilter.method(this) == FilterMethod.VPN &&
                !LightSetup.vpnSetupAllowed())

    /** Returns the app (not Settings, not an overlay) whose window just gained focus or became active. */
    @Suppress("DEPRECATION")
    private fun updateWindowSubscription(focusChanges: Int = 0): String? {
        val visibleWindows = windows
        var watchContent = visibleWindows.isEmpty()
        var app: String? = null
        for (window in visibleWindows) {
            try {
                val root = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    window.getRoot(0)
                } else {
                    window.root
                }
                val pkg = root?.packageName?.toString()
                root?.let(::recycle)
                if (pkg != null && !isOverlay(pkg)) windowOwners[window.id] = pkg
                val gainedFocus = (focusChanges and AccessibilityEvent.WINDOWS_CHANGE_FOCUSED) != 0 &&
                    window.isFocused
                val becameActive = (focusChanges and AccessibilityEvent.WINDOWS_CHANGE_ACTIVE) != 0 &&
                    window.isActive
                if (pkg != null && !guardsSettings(pkg)) {
                    if ((gainedFocus || becameActive) && !isOverlay(pkg) && !window.isInPictureInPictureMode) app = pkg
                    continue
                }
                watchContent = true
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
        return app
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

    private fun canGuardApps() =
        !Mode.isStrong(this) && !LightRelease.isReleased(this) && !Lock.isInMaintenanceWindow(this)

    private fun isInteractive(): Boolean =
        getSystemService(PowerManager::class.java)?.isInteractive == true

    private fun inCall() = getSystemService(android.media.AudioManager::class.java)?.mode == android.media.AudioManager.MODE_IN_CALL

    /**
     * The app in front by the active window, for checks that run without an event. Window events can
     * arrive late and out of order, so [foreground] alone can name a screen that is already gone.
     * Falls back to it when the active window is unreadable, an overlay or a floating window, unless
     * only a [live] answer will do.
     */
    private fun appInFront(live: Boolean = false): String? {
        val fallback = if (live) null else foreground
        val root = activeRootWithoutPrefetch() ?: return fallback
        val pkg = root.packageName?.toString()
        recycle(root)
        if (pkg == null || isOverlay(pkg) || pkg in pipPackages) return fallback
        if (pkg != foreground) Log.i(TAG, "in front: $pkg, not $foreground as the window events said")
        foreground = pkg
        return pkg
    }

    private fun guard(pkg: String, force: Boolean = false) {
        if (pkg == packageName) return
        when (LightLock.plan(this).why(pkg)) {
            LightPlan.Why.NOT_ALLOWED -> if (!openedForNow(pkg)) block(pkg, BlockedActivity.Reason.NOT_ALLOWED)
            LightPlan.Why.TIME_USED_UP -> if (!openedForNow(pkg)) block(pkg, BlockedActivity.Reason.TIME_USED_UP)
            null -> checkTime(pkg, force = force)
        }
    }

    /**
     * Closes a blocked app that plays on in picture-in-picture (see [PipGuard]): tries to dismiss the
     * window, then shows the stop screen, which also sends Home. Android 10 to 13 refuse the dismiss on
     * the window's own root (System UI takes it only on a node id no window reports), so the guard
     * then sends it to that id ([PipRootNode]). Only if that fails too is the app brought back to full
     * screen, where the stop screen covers it without the Home press that would let it float again.
     * The stop screen comes once per window; the dismiss is repeated while the window floats, also
     * without a window event for a few seconds after it (see [recheckPip]), and none of this depends
     * on which app is Home.
     */
    @Suppress("DEPRECATION")
    private fun guardPip() {
        val wins = ArrayList<PipGuard.Win>()
        val roots = HashMap<String, AccessibilityNodeInfo>()
        val seen = ArrayList<String>()
        // The pinned windows of each app, its own and System UI's menu: System UI takes a dismiss through any of them.
        val pinnedWindows = HashMap<String, MutableList<Int>>()
        // Read first, then resolve: a pinned app window names the app that System UI's menu may cover.
        class Raw(val id: Int, val label: String, val inPip: Boolean, val rootPkg: String?)
        val raw = ArrayList<Raw>()
        for (window in windows) {
            try {
                val inPip = window.isInPictureInPictureMode
                val root = if (!inPip) null else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) window.getRoot(0) else window.root
                val pkg = root?.packageName?.toString()
                raw += Raw(window.id, "$pkg#${window.id}@${window.layer}", inPip, pkg)
                // Only the app's own root takes a dismiss; System UI's menu root is not the app's window.
                if (root != null && pkg != null && pkg != PipGuard.SYSTEM_UI && !roots.containsKey(pkg)) roots[pkg] = root else root?.let(::recycle)
            } finally {
                if (Build.VERSION.SDK_INT < 33) window.recycle()
            }
        }
        val pinnedAppNow = raw.filter { it.inPip && it.rootPkg != PipGuard.SYSTEM_UI }
            .firstNotNullOfOrNull { PipGuard.owner(it.rootPkg, it.id, windowOwners, null, null) }
        pinnedApp = pinnedAppNow ?: pinnedApp.takeIf { raw.any { it.inPip } }
        // Not the app in front by the events: Home's event can come before the pinned window does.
        val inFront = lastApp
        for (r in raw) {
            val pkg = if (r.inPip) PipGuard.owner(r.rootPkg, r.id, windowOwners, pinnedApp, inFront) else null
            if (r.inPip && pinnedApp == null && pkg != null) pinnedApp = pkg
            if (r.inPip && r.rootPkg != null && r.rootPkg != PipGuard.SYSTEM_UI) windowOwners[r.id] = r.rootPkg
            wins += PipGuard.Win(pkg, r.inPip)
            if (r.inPip && pkg != null) pinnedWindows.getOrPut(pkg, ::ArrayList) += r.id
            if (r.inPip) seen += if (pkg != r.rootPkg) "${r.label} as $pkg" else r.label
        }
        // Logged on change only: this runs on every window-list change.
        val seenNow = seen.joinToString()
        if (seenNow != lastPipSeen) {
            Log.i(TAG, if (seen.isEmpty()) "pip: no window" else "pip: windows $seenNow")
            lastPipSeen = seenNow
        }
        pipPackages = PipGuard.packages(wins, packageName)
        pipStopped.retainAll(pipPackages.toSet())
        pipExpanded.retainAll(pipPackages.toSet())
        pipRechecks.keys.retainAll(pipPackages.toSet())
        // A floating app is not the app in front: blocking it as one would press Home, which on Android 10
        // holds back every app start for 5 s, the expand below included, and leaves the window floating.
        if (foreground in pipPackages) foreground = null
        // A call (112 included) is never pushed aside by the stop screen; the window is looked at again after it.
        val inCall = inCall()
        val plan = LightLock.plan(this)
        val targets = if (inCall) emptyList() else PipGuard.targets(wins, packageName, plan, pipStopped, ::openedForNow)
        if (!inCall) {
            PipGuard.stillFloating(wins, packageName, plan, pipStopped, ::openedForNow).forEach {
                dismissPip(it.pkg, roots[it.pkg], pinnedWindows[it.pkg].orEmpty())
                recheckPip(it.pkg)
            }
        }
        for (t in targets) {
            // Expanded once per window, like the stop screen: a task that stays pinned is not reopened on
            // every event while the rate limit holds the stop screen back (run 45125434098: six starts).
            // Not when System UI refused: it takes the dismiss again once its menu is gone, and starting
            // the app can add another activity to the pinned task instead (see [expandPip]).
            if (dismissPip(t.pkg, roots[t.pkg], pinnedWindows[t.pkg].orEmpty()) == PipDismiss.REFUSED &&
                !PipGuard.expandedRecently(pipExpandedAt[t.pkg], SystemClock.elapsedRealtime())
            ) expandPip(t.pkg)
            // Once per window: if dismissing does not close it, Home and the stop screen must not repeat every tick.
            if (block(t.pkg, if (t.why == LightPlan.Why.NOT_ALLOWED) BlockedActivity.Reason.NOT_ALLOWED else BlockedActivity.Reason.TIME_USED_UP)) pipStopped += t.pkg
            recheckPip(t.pkg)
        }
        roots.values.forEach(::recycle)
        // Time may be up before the stored plan knows it: the live check covers picture-in-picture apps too.
        val unchecked = pipPackages.filter { p -> p !in pipStopped && targets.none { it.pkg == p } && !isOverlay(p) }
        if (!inCall && unchecked.isNotEmpty()) pipTimeCheck(unchecked)
    }

    /** How a dismiss went: Android took it, System UI refused it for now, or nothing would take it. */
    private enum class PipDismiss { ACCEPTED, REFUSED_BY_SYSTEM_UI, REFUSED }

    private fun dismissPip(pkg: String, root: AccessibilityNodeInfo?, windowIds: List<Int>): PipDismiss {
        val dismissed = root?.performAction(AccessibilityNodeInfo.ACTION_DISMISS) == true
        Log.i(TAG, "pip $pkg: dismiss ${if (root == null) "without a root" else if (dismissed) "accepted" else "refused"}")
        if (dismissed) return PipDismiss.ACCEPTED
        return when (dismissThroughSystemUi(pkg, windowIds)) {
            true -> PipDismiss.ACCEPTED
            false -> PipDismiss.REFUSED_BY_SYSTEM_UI
            null -> PipDismiss.REFUSED
        }
    }

    /**
     * The dismiss on System UI's root node ([PipRootNode]), which removes the pinned task. Tried on
     * each pinned window of the app: one without an accessibility connection yet refuses it. Null when
     * it could not be sent at all.
     */
    private fun dismissThroughSystemUi(pkg: String, windowIds: List<Int>): Boolean? {
        if (!PipRootNode.supported || windowIds.isEmpty()) return null
        val connection = connectionId ?: rootInActiveWindow?.let(PipRootNode::connectionId)?.also { connectionId = it }
        if (connection == null) {
            Log.w(TAG, "pip $pkg: no connection id for System UI's dismiss")
            return null
        }
        var sent = false
        for (id in windowIds) {
            val node = PipRootNode.of(id, connection) ?: continue
            sent = true
            val dismissed = runCatching { node.performAction(AccessibilityNodeInfo.ACTION_DISMISS) }.getOrDefault(false)
            recycle(node)
            Log.i(TAG, "pip $pkg: System UI dismiss on window $id ${if (dismissed) "accepted" else "refused"}")
            if (dismissed) return true
        }
        return if (sent) false else null
    }

    /**
     * Looks again soon after a dismiss of [pkg]'s window, and dismisses again while it floats
     * ([PipGuard.RECHECK_DELAYS_MS]); window events and the tick do too. Bounded per window: when the
     * last re-check still finds it floating, the app is expanded under its stop screen instead, once,
     * unless that was done for this window already. After that only events and the tick dismiss again.
     */
    private fun recheckPip(pkg: String) {
        val done = pipRechecks.getOrPut(pkg) { 0 }
        if (done > PipGuard.RECHECK_DELAYS_MS.size) return
        val delay = PipGuard.recheckDelay(done)
        if (delay != null) {
            if (done > 0) Log.i(TAG, "pip $pkg: still floating after re-check $done")
            if (!main.hasCallbacks(pipRecheck)) main.postDelayed(pipRecheck, delay)
            return
        }
        pipRechecks[pkg] = done + 1
        Log.w(TAG, "pip $pkg: still floating after $done re-checks")
        if (pkg !in pipExpanded && !PipGuard.expandedRecently(pipExpandedAt[pkg], SystemClock.elapsedRealtime())) expandPip(pkg)
    }

    /**
     * Starting the app of a pinned task makes Android expand it to full screen (System UI's answer to
     * a pinned activity's restart, Android 10 and later). It is then an ordinary app in front. Only
     * when the start matches the task's own intent, though: Android 10 adds a second activity to the
     * pinned task otherwise (ActivityStarter.setTaskFromIntentActivity), and nothing expands.
     */
    private fun expandPip(pkg: String) {
        val launch = packageManager.getLaunchIntentForPackage(pkg)
        val started = launch != null && runCatching { startActivity(launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { Log.w(TAG, "pip $pkg: could not expand: ${it.message}") }.isSuccess
        Log.i(TAG, "pip $pkg: expand ${if (launch == null) "without a launch intent" else if (started) "requested" else "failed"}")
        if (started) {
            pipExpandedAt[pkg] = SystemClock.elapsedRealtime()
            pipExpanded += pkg
        }
    }

    /**
     * An emergency opening covers exactly this app right now. Only loosens an app block (never a
     * protection screen, never calls or texts). Makes sure the block comes back when the window ends.
     */
    private fun openedForNow(pkg: String): Boolean {
        if (!emergency.isActive(pkg)) return false
        scheduleEmergencyExpiry()
        return true
    }

    private fun scheduleEmergencyExpiry() {
        val left = emergency.activeLeftMs() ?: return
        main.removeCallbacks(emergencyExpiry)
        main.postDelayed(emergencyExpiry, left + 250L)
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
            if (guardsSettings(pkg)) dismissVpnDialog()
            return
        }
        val k = keywords
        if (k == null) {
            recycle(root)
            return
        }
        val texts = ArrayList<String>()
        collect(root, texts, depth = 0)
        val privateDns = LightFilter.method(this) == FilterMethod.PRIVATE_DNS
        if (!SettingsGuard.isProtectedScreen(pkg, texts, k, privateDns, privateDnsOptions,
                allowPrivateDnsEditor = privateDns && LightSetup.privateDnsSetupAllowed(this))) return
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
        // Per app: switching from one app to another must not skip the second app's check.
        if (!force && pkg == lastTimeCheckPkg && now - lastTimeCheck < 5_000L) return
        lastTimeCheck = now
        lastTimeCheckPkg = pkg
        if (worker.isShutdown || Lock.isInMaintenanceWindow(this)) return
        // Reading a day of usage events is slow; this process also shows the in-call screen.
        runCatching { worker.execute {
            val snap = runCatching { TimeGuard.snapshot(this) }.getOrNull() ?: return@execute
            if (pkg !in snap.blocked) {
                runCatching { LimitWarningNotifier.check(this, snap, pkg) }
                return@execute
            }
            main.post {
                if (foreground != pkg) return@post
                if (openedForNow(pkg)) return@post
                block(pkg, BlockedActivity.Reason.TIME_USED_UP)
                // Refresh the stored plan and tell the parent the minutes used.
                Lock.applyAsync(this, "time used up")
            }
        } } // a shutdown racing this call is ignored: the guard is going away

    }

    /** The live time check for apps in picture-in-picture (they are not "in front"). Own 5 s rate limit. */
    private fun pipTimeCheck(pkgs: List<String>) {
        if (LightRelease.isReleased(this)) return
        val now = SystemClock.elapsedRealtime()
        if (now - lastPipTimeCheck < 5_000L) return
        lastPipTimeCheck = now
        if (worker.isShutdown || Lock.isInMaintenanceWindow(this)) return
        runCatching { worker.execute {
            val snap = runCatching { TimeGuard.snapshot(this) }.getOrNull() ?: return@execute
            val used = pkgs.filter { it in snap.blocked }
            if (used.isEmpty()) return@execute
            main.post {
                val still = used.filter { it in pipPackages && it !in pipStopped && !openedForNow(it) }
                if (still.isEmpty()) return@post
                still.forEach { if (block(it, BlockedActivity.Reason.TIME_USED_UP)) pipStopped += it }
                Lock.applyAsync(this, "time used up")
            }
        } }
    }

    /** True when the stop screen was started; false when the rate limit dropped it (it is retried). */
    private fun block(pkg: String, reason: BlockedActivity.Reason): Boolean {
        if (LightRelease.isReleased(this)) return false
        val now = SystemClock.elapsedRealtime()
        if (now - lastBlockAt < BLOCK_GAP_MS) {
            // Dropped for now, not forgotten: a quick switch back to the app would otherwise keep it open.
            // The retry repeats the app check only. A dropped Settings or VPN-dialog block is left to the
            // Settings watch: its next content event, scheduled re-check or VPN retry runs it again.
            if (reason != BlockedActivity.Reason.PROTECTION) {
                main.removeCallbacks(reguard)
                main.postDelayed(reguard, BLOCK_GAP_MS - (now - lastBlockAt))
            }
            return false
        }
        lastBlockAt = now
        // An app just brought back from picture-in-picture is covered without a user leave: Home, or a
        // stop screen that counts as the user leaving, lets a video app float again at once.
        val quiet = PipGuard.expandedRecently(pipExpandedAt[pkg], now)
        if (reason != BlockedActivity.Reason.PROTECTION && !quiet) performGlobalAction(GLOBAL_ACTION_HOME)
        val intent = BlockedActivity.intent(this, pkg, reason)
        if (quiet) intent.addFlags(Intent.FLAG_ACTIVITY_NO_USER_ACTION)
        Log.i(TAG, "stop screen for $pkg: $reason${if (quiet) ", after expanding it" else ""}")
        runCatching { startActivity(intent) }
            .onFailure { Log.w(TAG, "could not show the blocked screen: ${it.message}") }
        // Settings and the VPN dialog have their own re-checks (see above).
        if (reason != BlockedActivity.Reason.PROTECTION) {
            main.removeCallbacks(settle)
            main.postDelayed(settle, SETTLE_MS)
        }
        return true
    }

    private fun collect(node: AccessibilityNodeInfo, out: MutableList<String>, depth: Int) {
        try {
            if (depth > 25 || out.size > 400) return
            node.viewIdResourceName?.let { out += it }
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
    private fun isOverlay(pkg: String) = pkg == "com.android.systemui" || pkg in keyboardPackages()

    private var homes: Set<String> = emptySet()
    private var homesAt = 0L

    /** Packages of the Home apps (launchers). Cached: it is a binder call. */
    private fun homePackages(): Set<String> {
        val now = SystemClock.elapsedRealtime()
        if (homesAt == 0L || now - homesAt > KEYBOARD_CACHE_MS) {
            val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
            homes = runCatching { packageManager.queryIntentActivities(home, 0).mapNotNull { it.activityInfo?.packageName }.toSet() }
                .getOrNull().orEmpty()
            homesAt = now
        }
        return homes
    }

    private var keyboards: Set<String> = emptySet()
    private var keyboardsAt = 0L

    /** Packages of the enabled keyboards, not any package with "inputmethod" in its name. Cached: it is a binder call. */
    private fun keyboardPackages(): Set<String> {
        val now = SystemClock.elapsedRealtime()
        if (keyboardsAt == 0L || now - keyboardsAt > KEYBOARD_CACHE_MS) {
            keyboards = runCatching { getSystemService(InputMethodManager::class.java)?.enabledInputMethodList?.map { it.packageName }?.toSet() }
                .getOrNull().orEmpty() + "com.android.inputmethod.latin"
            keyboardsAt = now
        }
        return keyboards
    }

    private val privateDnsOptions by lazy {
        listOf("private_dns_mode_provider", "private_dns_mode_provider_hostname").mapNotNull(::settingsString)
    }

    private fun buildKeywords(): SettingsGuard.Keywords {
        val fromSettings = SETTINGS_STRING_NAMES.mapNotNull { name -> settingsString(name) }
        return SettingsGuard.Keywords(
            ownDescriptions = listOf(getString(R.string.guard_description), getString(R.string.light_admin_description)),
            appName = getString(R.string.app_name),
            dangerous = (SettingsGuard.Keywords.BUILT_IN + fromSettings.map { it.lowercase() }).distinct(),
            vpnManagement = listOfNotNull(settingsString("vpn_require_connection")),
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
        main.removeCallbacks(emergencyExpiry)
        main.removeCallbacks(reguard)
        main.removeCallbacks(settle)
        main.removeCallbacks(pipRecheck)
        cancelSettingsChecks()
        screenReceiver?.let { runCatching { unregisterReceiver(it) } }
        screenReceiver = null
        planWatch?.let { LightLock.unwatchPlan(this, it) }
        planWatch = null
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
        private const val BLOCK_GAP_MS = 700L
        /** Long enough for a stop screen to be in front; short enough that a blocked app is not used meanwhile. */
        private const val SETTLE_MS = 1_500L
        private const val WINDOW_OWNERS_KEPT = 32
        private const val KEYBOARD_CACHE_MS = 60_000L

        @Volatile var isConnected = false
            private set
        @Volatile private var instance: java.lang.ref.WeakReference<GuardService>? = null

        /** What the guard believes now, for a failing end-to-end check's message. Main thread state, read loosely. */
        fun describe(): String = instance?.get()?.let {
            runCatching {
                "guard: in front ${it.foreground}, pinned ${it.pinnedApp}, floating ${it.pipPackages}, stopped ${it.pipStopped.toList()}, re-checks ${it.pipRechecks}"
            }.getOrElse { e -> "guard: unreadable (${e.javaClass.simpleName})" }
        } ?: "guard: not running"

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
