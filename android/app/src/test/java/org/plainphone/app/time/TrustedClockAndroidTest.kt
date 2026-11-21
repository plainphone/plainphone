// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.app.AlarmManager
import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.google.common.collect.Range
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.light.AskMoreTimeController
import org.plainphone.app.light.BlockedActivity
import org.plainphone.app.light.EmergencyOpenings
import org.plainphone.app.light.EmergencyRefusal
import org.plainphone.app.light.EmergencyRules
import org.plainphone.app.light.EmergencyStart
import org.plainphone.app.sync.StatusNotices
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.TimeLimits
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowUsageStatsManager.EventBuilder

/**
 * The phone's own wiring: a light-mode phone (no Device Owner under Robolectric) enforces on the
 * server's time. The server's time here is years from the real date, so the test cannot pass on the
 * phone's clock by chance.
 */
@RunWith(RobolectricTestRunner::class)
class TrustedClockAndroidTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val cph = ZoneId.of("Europe/Copenhagen")

    private fun local(text: String) = ZonedDateTime.of(LocalDateTime.parse(text), cph).toInstant().toEpochMilli()

    @Before
    fun boot() {
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 4)
    }

    private fun serverSays(ms: Long) = TrustedClock.of(context).onServerTime(ms, SystemClock.elapsedRealtime())

    @Test
    fun `the lock config follows the server's time, not the phone's clock`() {
        // Bedtime only on Monday 22:00 to 22:05, so the real date is almost never inside it.
        val bedtime = """[{"id":"b","kind":"bedtime","days":[1],"start":"22:00","end":"22:05","allowedPackages":["com.spotify.music"]}]"""
        SyncStore(context).saveRules("\"r\"", rulesJson(schedules = bedtime), 0L)
        serverSays(local("2031-06-02T22:02")) // a Monday
        val config = Lock.effectiveConfig(context)
        assertThat(config.server!!.windowActive).isTrue()
        assertThat(config.allowedPackages).containsExactly("com.spotify.music")
    }

    @Test
    fun `emergency openings count against the server's month`() {
        serverSays(local("2031-06-15T12:00"))
        val openings = EmergencyOpenings.of(context)
        // The server counted all three of June's openings; the phone's clock is in another month.
        val usedUp = EmergencyRules(enabled = true, allowance = 3, minutes = 15, usedMonth = "2031-06", usedCount = 3)
        val start = openings.start("com.example.game", BlockedActivity.Reason.NOT_ALLOWED, true, usedUp, cph, context.packageName)
        assertThat(start).isEqualTo(EmergencyStart.Refused(EmergencyRefusal.NONE_LEFT))
        val fresh = usedUp.copy(usedCount = 0)
        val started = openings.start("com.example.game", BlockedActivity.Reason.NOT_ALLOWED, true, fresh, cph, context.packageName)
        assertThat((started as EmergencyStart.Started).opening.openedAtMs).isAtLeast(local("2031-06-15T12:00"))
        assertThat(started.opening.openedAtMs).isLessThan(local("2031-06-15T12:01"))
    }

    @Test
    fun `the server's time survives a new instance and a moved clock is told once`() {
        serverSays(System.currentTimeMillis() - 3_600_000L)
        assertThat(TrustedClock.of(context).now().source).isEqualTo(TrustedTime.Source.SERVER)
        val notices = StatusNotices(context)
        val first = checkNotNull(notices.pending(StatusNotices.CLOCK_MOVED))
        notices.acknowledge(StatusNotices.CLOCK_MOVED, first)
        TrustedClock.of(context).now()
        assertThat(notices.pending(StatusNotices.CLOCK_MOVED)).isNull()
    }

    @Test
    fun `a new boot without a sync is only a lower bound`() {
        serverSays(local("2031-06-02T20:00"))
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 5)
        val time = TrustedClock.of(context).now()
        assertThat(time.source).isEqualTo(TrustedTime.Source.SINCE_RESTART)
        assertThat(time.earliest.toEpochMilli()).isAtLeast(local("2031-06-02T20:00"))
        assertThat(time.latest.toEpochMilli()).isAtLeast(time.earliest.toEpochMilli() + TrustedClock.MAX_UNSYNCED_MS)
    }

    @Test
    fun `the window alarm runs on the boot clock, timed from the server's time`() {
        val bedtime = """[{"id":"b","kind":"bedtime","days":[1],"start":"22:00","end":"22:05","allowedPackages":[]}]"""
        SyncStore(context).saveRules("\"r\"", rulesJson(schedules = bedtime), 0L)
        // Odd seconds and millis, so the phone's clock cannot give the same delay by chance.
        serverSays(local("2031-06-02T21:50") + 17_123L)
        Lock.scheduleNextWindowChange(context)
        val alarm = shadowOf(context.getSystemService(AlarmManager::class.java)).scheduledAlarms.single()
        assertThat(alarm.getType()).isEqualTo(AlarmManager.ELAPSED_REALTIME_WAKEUP)
        assertThat(alarm.triggerAtMs).isEqualTo(SystemClock.elapsedRealtime() + 600_000L - 17_123L + 1_000L)
    }

    @Test
    fun `the midnight alarm for time limits is the server's midnight`() {
        SyncStore(context).saveRules("\"r\"", rulesJson(timezone = "UTC", timeLimits = """{"total":{"minutes":60}}"""), 0L)
        serverSays(utc("2031-06-02T23:40") + 17_123L)
        Lock.scheduleNextWindowChange(context)
        val alarm = shadowOf(context.getSystemService(AlarmManager::class.java)).scheduledAlarms.single()
        assertThat(alarm.getType()).isEqualTo(AlarmManager.ELAPSED_REALTIME_WAKEUP)
        assertThat(alarm.triggerAtMs).isEqualTo(SystemClock.elapsedRealtime() + 1_200_000L - 17_123L + 1_000L)
    }

    @Test
    fun `daily caps count the server's day, from its midnight on the phone's clock`() {
        // Only the server's day has time (a 45-minute bonus); on the phone's own day the cap is 0.
        val limits = """{"total":{"minutes":0},"bonuses":[{"packageName":"*","date":"2031-06-02","minutes":45}]}"""
        SyncStore(context).saveRules("\"r\"", rulesJson(timezone = "UTC", timeLimits = limits), 0L)
        val wall = System.currentTimeMillis()
        // The server's time of day is 10 hours off the phone's, so the two midnights are 10 hours apart.
        val wallOfDay = Math.floorMod(wall, DAY)
        val serverOfDay = if (wallOfDay >= 12 * HOUR) wallOfDay - 10 * HOUR else wallOfDay + 10 * HOUR
        serverSays(utc("2031-06-02T00:00") + serverOfDay)
        val midnightOnWall = wall - serverOfDay
        grantUsageAccess()
        // Open from 30 minutes before the server's midnight to 30 minutes after: only the last 30 count.
        foreground("com.example.game", midnightOnWall - 30 * MINUTE, midnightOnWall + 30 * MINUTE)

        val snapshot = checkNotNull(TimeGuard.snapshot(context))
        // The phone's clock runs on a few milliseconds while the test sets up.
        assertThat(snapshot.evaluation.totalUsedMs).isIn(Range.closed(30 * MINUTE - 1_000L, 30 * MINUTE))
        assertThat(snapshot.evaluation.totalRemainingMs).isIn(Range.closed(15 * MINUTE, 15 * MINUTE + 1_000L))
        assertThat(snapshot.blocked).isEmpty()
    }

    @Test
    fun `an ask for more time is saved on the server's day`() {
        SyncStore(context).saveRules("\"r\"", rulesJson(timezone = "UTC", timeLimits = """{"total":{"minutes":0}}"""), 0L)
        serverSays(utc("2031-06-02T12:00"))
        assertThat(AskMoreTimeController(context, "com.example.game").ask("homework")).isNotNull()
        val asks = SyncStore(context).moreTime.all(LocalDate.of(2031, 6, 2))
        assertThat(asks.map { it.target }).containsExactly(TimeLimits.TOTAL)
        assertThat(asks.single().createdAtMs).isAtLeast(utc("2031-06-02T12:00"))
    }

    @Test
    fun `the catalog's windows a day count the server's day`() {
        val toInstall = """[{"packageName":"org.example.approved","label":"Approved"}]"""
        SyncStore(context).saveRules("\"r\"", rulesJson(toInstall = toInstall), 0L)
        serverSays(local("2031-06-02T12:00"))
        val serverDay = Instant.ofEpochMilli(local("2031-06-02T12:00")).atZone(ZoneId.systemDefault()).toLocalDate()
        context.getSharedPreferences("plainphone_install", Context.MODE_PRIVATE).edit()
            .putString("day", serverDay.toString()).putInt("windows", InstallWindow.MAX_PER_DAY).commit()
        // The phone's clock is on another day, where no window was used yet.
        val result = InstallWindow.open(context, "org.example.approved") { error("no window on a used-up day") }
        assertThat(result).isEqualTo(InstallWindow.OpenResult.DAILY_LIMIT)
    }

    private fun utc(text: String) = LocalDateTime.parse(text).toInstant(ZoneOffset.UTC).toEpochMilli()

    private fun grantUsageAccess() {
        shadowOf(context.getSystemService(AppOpsManager::class.java)).setMode(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName, AppOpsManager.MODE_ALLOWED,
        )
    }

    private fun foreground(pkg: String, from: Long, until: Long) {
        val stats = shadowOf(context.getSystemService(UsageStatsManager::class.java))
        for ((at, type) in listOf(from to UsageEvents.Event.ACTIVITY_RESUMED, until to UsageEvents.Event.ACTIVITY_PAUSED)) {
            stats.addEvent(EventBuilder.buildEvent().setPackage(pkg).setClass("Game").setTimeStamp(at).setEventType(type).build())
        }
    }

    private companion object {
        const val MINUTE = 60_000L
        const val HOUR = 60 * MINUTE
        const val DAY = 24 * HOUR
    }
}
