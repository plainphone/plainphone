// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.AndroidHardeningControls
import org.plainphone.app.Compat
import org.plainphone.app.Hardening
import org.plainphone.app.Lock
import org.plainphone.app.contacts.HelpActivity
import org.plainphone.app.provisioning.EnrollmentAccountNotice
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.TimeLimits
import org.plainphone.app.time.TimeGuard

/**
 * Plainphone's home screen: the time, the date, a few apps and the phone. Strong mode makes it the
 * home screen Android always opens; light mode offers to pick it.
 */
class HomeActivity : ComponentActivity() {
    private val enrollmentNotice by lazy { EnrollmentAccountNotice(this) { !roleDialogOpen } }
    private var resumed by mutableIntStateOf(0)
    /** Only refresh while the home screen can be seen: it lives as long as the phone is on. */
    private var onScreen by mutableStateOf(false)

    private val askedRoles = mutableSetOf<String>()
    private var roleDialogOpen = false
    private val roleRequest = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        roleDialogOpen = false
        Lock.applyIfNeededAsync(this, "call role dialog", maxAgeMs = 0) {
            SyncScheduler.now(this, "call role dialog")
        }
        askForCallRole()
        if (lifecycle.currentState == androidx.lifecycle.Lifecycle.State.RESUMED) enrollmentNotice.start()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        if (!HomeGuard.starting(this)) {
            super.onCreate(savedInstanceState)
            finish()
            // Plainphone is no longer a home app now: this lands on the maker's launcher.
            runCatching { startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            return
        }
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            // Runs after the first frame was composed without crashing.
            LaunchedEffect(Unit) { HomeGuard.drawn(this@HomeActivity) }
            var showSos by rememberSaveable { mutableStateOf(false) }
            var showAll by rememberSaveable { mutableStateOf(false) }
            var ui by remember { mutableStateOf<HomeUi?>(null) }
            val tick = resumed
            val active = onScreen
            LaunchedEffect(tick) {
                // Pressing Home again always lands on the front page.
                showAll = false
            }
            LaunchedEffect(tick, active) {
                while (active) {
                    ui = withContext(Dispatchers.Default) { runCatching { load(this@HomeActivity) }.onFailure { Log.e(TAG, "home", it) }.getOrNull() } ?: ui
                    // Wake on the next minute, so the clock and school time stay right.
                    delay(60_000L - System.currentTimeMillis() % 60_000L + 200L)
                }
            }
            BackHandler(enabled = !showSos && showAll) { showAll = false }
            BackHandler(enabled = !showSos && !showAll) { /* Home has nowhere to go back to. */ }
            val current = ui
            val prefs = current?.state?.prefs ?: HomePrefs.DEFAULT
            val dark = when (prefs.theme) {
                HomeTheme.SYSTEM -> isSystemInDarkTheme()
                HomeTheme.LIGHT -> false
                HomeTheme.DARK -> true
            }
            HomeTheme(homeColors(prefs.palette, dark)) {
                if (showSos) {
                    BackHandler { showSos = false }
                    org.plainphone.app.ui.PlainphoneTheme {
                        org.plainphone.app.sos.SosScreen(onBack = { showSos = false }, emergency = ::openEmergency)
                    }
                } else HomeScreen(
                    current ?: HomeUi(HomeState(prefs, emptyList(), emptyList(), null), "", ""),
                    showAll,
                    onShowAll = { showAll = it },
                    actions = HomeActions(
                        open = ::openApp,
                        phone = ::openPhone,
                        messages = ::openMessages,
                        sos = { showSos = true },
                        help = { startActivity(Intent(this@HomeActivity, HelpActivity::class.java)) },
                        makeDefault = ::askToBeHome,
                        selfTools = if (org.plainphone.app.light.LightSetup.profile(this@HomeActivity) == "self") {
                            { startActivity(Intent(this@HomeActivity, org.plainphone.app.light.HomeActivity::class.java)) }
                        } else null,
                    ),
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        onScreen = true
    }

    override fun onResume() {
        super.onResume()
        resumed++
        askForCallRole()
        enrollmentNotice.start()
    }

    override fun onPause() {
        enrollmentNotice.stop()
        super.onPause()
    }

    private fun askForCallRole() {
        if (roleDialogOpen || isFinishing || !onScreen || Lock.isInMaintenanceWindow(this) ||
            android.os.Build.VERSION.SDK_INT >= 34 ||
            getSystemService(DevicePolicyManager::class.java)?.isDeviceOwnerApp(packageName) != true
        ) return
        val roles = getSystemService(RoleManager::class.java) ?: return
        val role = Hardening.nextRoleToRequest(
            android.os.Build.VERSION.SDK_INT,
            Lock.applier(this).needsDialerDialog() && roles.isRoleAvailable(RoleManager.ROLE_DIALER),
            AndroidHardeningControls(this)::roleState,
            askedRoles,
        ) ?: return
        askedRoles += role
        roleDialogOpen = runCatching { roleRequest.launch(roles.createRequestRoleIntent(role)) }.isSuccess
    }

    override fun onStop() {
        super.onStop()
        onScreen = false
        if (!roleDialogOpen) askedRoles.clear()
    }

    private fun openApp(app: HomeApp) {
        val component = ComponentName.unflattenFromString(app.component) ?: return
        val intent = Intent(Intent.ACTION_MAIN)
            .addCategory(Intent.CATEGORY_LAUNCHER)
            .setComponent(component)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        // The app may have been hidden by a rule a moment ago.
        if (runCatching { startActivity(intent) }.isFailure) resumed++
    }

    private fun holds(role: String) = getSystemService(RoleManager::class.java)?.isRoleHeld(role) == true

    private fun openPhone() {
        val intent = if (holds(RoleManager.ROLE_DIALER)) {
            Intent(Intent.ACTION_MAIN).setComponent(ComponentName(this, PHONE))
        } else {
            Intent(Intent.ACTION_DIAL)
        }
        runCatching { startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    private fun openMessages() {
        val intent = if (holds(RoleManager.ROLE_SMS)) {
            Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setComponent(ComponentName(this, MESSAGES))
        } else {
            Intent.makeMainSelectorActivity(Intent.ACTION_MAIN, Intent.CATEGORY_APP_MESSAGING)
        }
        runCatching { startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }

    /**
     * Android's emergency dialer (the same screen as "Emergency call" on the lock screen), which
     * works whatever the contact rules say. Fallback: the keypad with 112, which Plainphone always lets through.
     */
    private fun openEmergency() {
        org.plainphone.app.sos.openEmergencyDialer(this)
    }

    /** Light mode: Android's own "choose home app" dialog. */
    private fun askToBeHome() {
        val roles = getSystemService(RoleManager::class.java) ?: return
        if (!roles.isRoleAvailable(RoleManager.ROLE_HOME)) return
        @Suppress("DEPRECATION") // A plain result-less request; onResume refreshes the state.
        runCatching { startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_HOME), 1) }
    }

    companion object {
        private const val TAG = "Plainphone"
        private const val PHONE = "org.plainphone.app.ui.PhoneActivity"
        private const val MESSAGES = "org.plainphone.app.ui.MessagesLauncher"

        /** Reads the phone's apps and the last rules. Off the main thread: loading labels takes a moment. */
        fun load(context: Context, now: Instant = Instant.now()): HomeUi {
            val pm = context.packageManager
            val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            val apps = Compat.queryActivities(pm, launcher, 0).map {
                val info = it.activityInfo
                LaunchableApp(info.packageName, it.loadLabel(pm).toString(), ComponentName(info.packageName, info.name).flattenToString())
            }
            val rules = SyncStore(context).rules()
            val own = context.packageName
            val state = HomeModel.build(
                apps = apps,
                rules = rules,
                now = now,
                fixed = setOf("$own/$PHONE", "$own/$MESSAGES"),
                // The same core apps light mode lets through, plus Plainphone itself (its status screen).
                core = corePackages(context) + own,
                minutesLeft = runCatching { HomeTimeLimits.source(context, apps.map { it.packageName }) }.getOrDefault(emptyMap()),
            )
            // The clock follows the phone (automatic time zone), like the status bar; schedules use the rules' zone.
            val at = ZonedDateTime.ofInstant(now, ZoneId.systemDefault())
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            val isOwner = dpm?.isDeviceOwnerApp(own) == true
            val isHome = context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_HOME) == true
            return HomeUi(
                state = state,
                time = timeText(context, at.toLocalTime()),
                date = dateText(at, context.resources.configuration.locales[0]),
                noticeUntil = state.notice?.let { timeText(context, it.until) },
                offerDefaultHome = !isOwner && !isHome,
            )
        }

        @Volatile private var coreCache: Pair<Long, Set<String>>? = null

        /** Resolving the core apps is not free and the home screen refreshes every minute: cached for 5 min. */
        private fun corePackages(context: Context): Set<String> {
            val now = System.currentTimeMillis()
            coreCache?.let { (at, set) -> if (now - at < 5 * 60_000L) return set }
            val set = runCatching { AndroidDeviceControls(context).corePackages() }.getOrDefault(emptySet())
            coreCache = now to set
            return set
        }

        fun timeText(context: Context, time: LocalTime): String {
            val pattern = if (android.text.format.DateFormat.is24HourFormat(context)) "HH:mm" else "h:mm"
            return time.format(DateTimeFormatter.ofPattern(pattern))
        }

        /** "Tuesday 17 November" / "tirsdag 17. november", with a capital first letter. */
        fun dateText(at: ZonedDateTime, locale: Locale): String {
            val pattern = android.text.format.DateFormat.getBestDateTimePattern(locale, "EEEEdMMMM").replace(",", "")
            return at.format(DateTimeFormatter.ofPattern(pattern, locale)).replaceFirstChar { it.titlecase(locale) }
        }
    }
}

/**
 * Where the home screen reads "minutes left today" per package: the parent's time limits
 * (docs/time-limits.md), evaluated by [TimeGuard]. Tests can replace [source].
 */
object HomeTimeLimits {
    @Volatile
    var source: (Context, Collection<String>) -> Map<String, Int> = { context, packages ->
        // Without usage access no use is counted, and every cap would look untouched all day.
        if (!TimeGuard.hasUsageAccess(context)) emptyMap()
        else TimeGuard.snapshot(context)?.let { minutesLeft(it.evaluation, it.exempt, packages) }.orEmpty()
    }

    /**
     * Whole minutes left for each of [packages] that a cap applies to (its own or the total),
     * rounded up so an app shows "used up" only when it is. Core apps are never limited.
     */
    fun minutesLeft(evaluation: TimeLimits.Evaluation, exempt: Set<String>, packages: Collection<String>): Map<String, Int> =
        packages.filter { it !in exempt }.mapNotNull { pkg ->
            evaluation.remainingFor(pkg)?.let { ms -> pkg to ((ms + 59_999L) / 60_000L).toInt() }
        }.toMap()
}
