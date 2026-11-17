// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Process
import java.time.Instant
import java.time.ZoneId
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.Compat
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.TimeLimits
import org.plainphone.app.sync.UsageCounter

/**
 * Time limits on the phone: reads today's foreground time from UsageStats and evaluates the
 * parent's limits offline. Strong mode suspends used-up apps (PolicyApplier), light mode closes
 * them with the accessibility service. Phone, messages, maps, clock and the other core apps are
 * never counted and never blocked, so calls (and emergency calls) always work.
 */
object TimeGuard {
    data class Snapshot(
        val limits: TimeLimits,
        val evaluation: TimeLimits.Evaluation,
        /** Apps blocked for the rest of the day. */
        val blocked: Set<String>,
        val exempt: Set<String>,
    )

    @Volatile private var exemptCache: Pair<Long, Set<String>>? = null

    /** Whether Plainphone may read usage stats (Settings > Usage access). */
    fun hasUsageAccess(context: Context): Boolean {
        val ops = context.getSystemService(AppOpsManager::class.java) ?: return false
        // Deprecated in API 37 in favour of a call that does not exist on Android 10; this one works on all of them.
        @Suppress("DEPRECATION")
        val mode = ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName)
        return mode == AppOpsManager.MODE_ALLOWED
    }

    /** Null when there are no limits (or no rules yet). */
    fun snapshot(context: Context, now: Instant = Instant.now()): Snapshot? {
        val rules = SyncStore(context).rules() ?: return null
        val limits = rules.timeLimits
        if (limits.isEmpty) return null
        val exempt = exempt(context)
        val zone = rules.timezone
        val used = if (hasUsageAccess(context)) foregroundToday(context, now, zone) else emptyMap()
        val evaluation = limits.evaluate(used, now.atZone(zone).toLocalDate(), exempt)
        val blocked = if (evaluation.totalUsedUp) {
            AndroidDeviceControls(context).launchablePackages() + evaluation.usedUpApps - exempt
        } else {
            evaluation.usedUpApps - exempt
        }
        return Snapshot(limits, evaluation, blocked, exempt)
    }

    /** Apps blocked by time right now; empty without limits. */
    fun blockedNow(context: Context, now: Instant = Instant.now()): Set<String> = snapshot(context, now)?.blocked.orEmpty()

    /** Core apps, maps and Plainphone itself. Cached for a few minutes: resolving intents is not free. */
    fun exempt(context: Context): Set<String> {
        val now = System.currentTimeMillis()
        exemptCache?.let { (at, set) -> if (now - at < 5 * 60_000L) return set }
        val controls = AndroidDeviceControls(context)
        val pm = context.packageManager
        val maps = Compat.queryActivities(pm, Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=x")), 0)
            .map { it.activityInfo.packageName }
        val apps = controls.telephonyApps()
        val set = controls.corePackages() + maps + listOfNotNull(apps.systemDialer) + context.packageName
        exemptCache = now to set
        return set
    }

    private fun foregroundToday(context: Context, now: Instant, zone: ZoneId): Map<String, Long> {
        val usm = context.getSystemService(UsageStatsManager::class.java) ?: return emptyMap()
        val dayStart = UsageCounter.dayStartMs(now, zone)
        // Start a little before midnight so an app that was open then is counted from midnight.
        val events = usm.queryEvents(dayStart - 3 * 3_600_000L, now.toEpochMilli()) ?: return emptyMap()
        val out = ArrayList<UsageCounter.Event>()
        val e = UsageEvents.Event()
        while (events.hasNextEvent()) {
            events.getNextEvent(e)
            val kind = when (e.eventType) {
                UsageEvents.Event.ACTIVITY_RESUMED -> UsageCounter.Kind.RESUMED
                UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> UsageCounter.Kind.PAUSED
                UsageEvents.Event.SCREEN_NON_INTERACTIVE, UsageEvents.Event.KEYGUARD_SHOWN,
                UsageEvents.Event.DEVICE_SHUTDOWN -> UsageCounter.Kind.SCREEN_OFF
                else -> null
            } ?: continue
            out += UsageCounter.Event(e.packageName ?: "", kind, e.timeStamp)
        }
        return UsageCounter.foregroundMs(out, dayStart, now.toEpochMilli())
    }
}
