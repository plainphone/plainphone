// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import org.plainphone.app.Compat
import org.plainphone.app.sync.SyncStore

/**
 * Plainphone's home screen: the time, the date, a few apps and the phone. Strong mode makes it the
 * home screen Android always opens; light mode offers to pick it.
 */
class HomeActivity : ComponentActivity() {
    private var resumed by mutableIntStateOf(0)
    /** Only refresh while the home screen can be seen: it lives as long as the phone is on. */
    private var onScreen by mutableStateOf(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        HomeGuard.starting(this)
        enableEdgeToEdge()
        super.onCreate(savedInstanceState)
        setContent {
            // Runs after the first frame was composed without crashing.
            LaunchedEffect(Unit) { HomeGuard.drawn(this@HomeActivity) }
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
            BackHandler(enabled = showAll) { showAll = false }
            BackHandler(enabled = !showAll) { /* Home has nowhere to go back to. */ }
            val current = ui
            val prefs = current?.state?.prefs ?: HomePrefs.DEFAULT
            val dark = when (prefs.theme) {
                HomeTheme.SYSTEM -> isSystemInDarkTheme()
                HomeTheme.LIGHT -> false
                HomeTheme.DARK -> true
            }
            HomeTheme(homeColors(prefs.palette, dark)) {
                HomeScreen(
                    current ?: HomeUi(HomeState(prefs, emptyList(), emptyList(), null), "", ""),
                    showAll,
                    onShowAll = { showAll = it },
                    actions = HomeActions(
                        open = ::openApp,
                        phone = ::openPhone,
                        messages = ::openMessages,
                        emergency = ::openEmergency,
                        makeDefault = ::askToBeHome,
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
    }

    override fun onStop() {
        super.onStop()
        onScreen = false
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
        val system = Intent(EMERGENCY_DIALER).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (runCatching { startActivity(system) }.isSuccess) return
        runCatching { startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:112")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
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
        /** The platform's emergency dialer action (packages/services/Telephony, exported on AOSP and maker builds). */
        private const val EMERGENCY_DIALER = "com.android.phone.EmergencyDialer.DIAL"
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
                core = runCatching { AndroidDeviceControls(context).corePackages() }.getOrDefault(emptySet()),
                minutesLeft = runCatching { HomeTimeLimits.source(context) }.getOrDefault(emptyMap()),
            )
            // The clock follows the phone (automatic time zone), like the status bar; schedules use the rules' zone.
            val at = ZonedDateTime.ofInstant(now, ZoneId.systemDefault())
            val dpm = context.getSystemService(DevicePolicyManager::class.java)
            val isOwner = dpm?.isDeviceOwnerApp(own) == true
            val isHome = context.getSystemService(RoleManager::class.java)?.isRoleHeld(RoleManager.ROLE_HOME) == true
            return HomeUi(
                state = state,
                time = timeText(context, at.toLocalTime()),
                date = dateText(at, Locale.getDefault()),
                noticeUntil = state.notice?.let { timeText(context, it.until) },
                offerDefaultHome = !isOwner && !isHome,
            )
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
 * Where the home screen reads "minutes left today" per package. Empty until app time limits are
 * wired in; the time-limit code sets [source].
 */
object HomeTimeLimits {
    @Volatile
    var source: (Context) -> Map<String, Int> = { emptyMap() }
}
