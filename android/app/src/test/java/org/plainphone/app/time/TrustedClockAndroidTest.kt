// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.content.Context
import android.os.SystemClock
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZonedDateTime
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.light.BlockedActivity
import org.plainphone.app.light.EmergencyOpenings
import org.plainphone.app.light.EmergencyRefusal
import org.plainphone.app.light.EmergencyRules
import org.plainphone.app.light.EmergencyStart
import org.plainphone.app.sync.StatusNotices
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner

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
}
