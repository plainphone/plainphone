// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.content.Context
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.home.HomeActivity
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.FakeSyncApi
import org.plainphone.app.sync.FakeSyncDevice
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.MoreTimeRequest
import org.plainphone.app.sync.RulesResult
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.TimeLimits
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner

/** The child's side of asking for more time: target, saved asks, sending and the screen state. */
@RunWith(RobolectricTestRunner::class)
class MoreTimeTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val day = LocalDate.of(2027, 1, 4)
    private val spotify = "com.spotify.music"
    private val min = 60_000L
    private val t0 = Instant.parse("2027-01-04T13:00:00Z").toEpochMilli()
    private val hhmm: (Long) -> String = { ms -> "end+${(ms - t0) / min}" }

    private fun asks() = MoreTimeAsks(context.getSharedPreferences("more-time-test-${System.nanoTime()}", Context.MODE_PRIVATE))

    private fun eval(totalLeft: Long?, appLeft: Long?) =
        TimeLimits.Evaluation(totalLeft, listOfNotNull(appLeft?.let { spotify to it }).toMap(), 0L, emptyMap())

    private fun ask(status: MoreTimeAsk.Status, answer: String? = null, granted: Int? = null, cap: Int? = 30, at: Long = t0) =
        MoreTimeAsk(spotify, day, null, at, cap, status, "r1", answer, granted)

    @Test
    fun `the target is the total when it is used up, else the app`() {
        assertThat(MoreTime.target(eval(0, 0), spotify) { null }).isEqualTo(TimeLimits.TOTAL)
        assertThat(MoreTime.target(eval(0, 10 * min), spotify) { null }).isEqualTo(TimeLimits.TOTAL)
        assertThat(MoreTime.target(eval(30 * min, 0), spotify) { null }).isEqualTo(spotify)
        assertThat(MoreTime.target(eval(null, 0), spotify) { null }).isEqualTo(spotify)
        // Nothing used up and never asked: nothing to show.
        assertThat(MoreTime.target(eval(30 * min, 10 * min), spotify) { null }).isNull()
        // A bonus arrived: the screen still shows today's last ask.
        val total = ask(MoreTimeAsk.Status.APPROVED).copy(target = TimeLimits.TOTAL, createdAtMs = t0 + 1)
        assertThat(MoreTime.target(eval(30 * min, 10 * min), spotify) { if (it == TimeLimits.TOTAL) total else ask(MoreTimeAsk.Status.DECLINED) })
            .isEqualTo(TimeLimits.TOTAL)
    }

    @Test
    fun `every server state has calm words on the screen`() {
        fun ui(a: MoreTimeAsk?, now: Long = t0 + min, cap: Int? = 30, left: Long? = 0) = MoreTime.ui(a, day, now, cap, left, hhmm)
        assertThat(ui(null)).isEqualTo(MoreTime.Ui.Offer)
        assertThat(ui(ask(MoreTimeAsk.Status.QUEUED))).isEqualTo(MoreTime.Ui.Saved)
        assertThat(ui(ask(MoreTimeAsk.Status.PENDING))).isEqualTo(MoreTime.Ui.Waiting)
        assertThat(ui(ask(MoreTimeAsk.Status.PENDING), now = t0 + 29 * min)).isEqualTo(MoreTime.Ui.Waiting)
        assertThat(ui(ask(MoreTimeAsk.Status.PENDING), now = t0 + 30 * min)).isEqualTo(MoreTime.Ui.NoAnswerYet)
        assertThat(ui(ask(MoreTimeAsk.Status.DECLINED, "no"))).isEqualTo(MoreTime.Ui.Declined)
        assertThat(ui(ask(MoreTimeAsk.Status.EXPIRED))).isEqualTo(MoreTime.Ui.Expired)
        assertThat(ui(ask(MoreTimeAsk.Status.UNAVAILABLE))).isEqualTo(MoreTime.Ui.Unavailable)
        // Yesterday's ask does not count today.
        assertThat(ui(ask(MoreTimeAsk.Status.DECLINED).copy(day = day.minusDays(1)))).isEqualTo(MoreTime.Ui.Offer)
    }

    @Test
    fun `approved shows the new end time, from the rules once the bonus is there`() {
        val approved = ask(MoreTimeAsk.Status.APPROVED, "15", 15)
        // Answer seen before the rules: the end is now + the granted minutes.
        assertThat(MoreTime.ui(approved, day, t0, 30, 0, hhmm)).isEqualTo(MoreTime.Ui.Approved("end+15"))
        // The bonus arrived (cap 30 -> 45) and some of it is used: the end follows what is left.
        assertThat(MoreTime.ui(approved, day, t0, 45, 9 * min, hhmm)).isEqualTo(MoreTime.Ui.Approved("end+9"))
        // The extra time is used up as well: the child may ask again.
        assertThat(MoreTime.ui(approved, day, t0, 45, 0, hhmm)).isEqualTo(MoreTime.Ui.Offer)
        // The rest of the day has no clock time.
        assertThat(MoreTime.ui(ask(MoreTimeAsk.Status.APPROVED, "day", 214), day, t0, 30, 0, hhmm)).isEqualTo(MoreTime.Ui.Approved(null))
    }

    @Test
    fun `the end time follows the phone's 12 or 24 hour setting`() {
        Settings.System.putString(context.contentResolver, Settings.System.TIME_12_24, "24")
        assertThat(HomeActivity.timeText(context, LocalTime.of(14, 35))).isEqualTo("14:35")
        Settings.System.putString(context.contentResolver, Settings.System.TIME_12_24, "12")
        assertThat(HomeActivity.timeText(context, LocalTime.of(14, 35))).isEqualTo("2:35")
    }

    @Test
    fun `the same target is never asked twice while open, and survives a new store`() {
        val prefs = context.getSharedPreferences("more-time-same", Context.MODE_PRIVATE)
        val asks = MoreTimeAsks(prefs)
        val first = asks.ask(spotify, day, "  Finishing a playlist ", t0, 30)
        assertThat(first.reason).isEqualTo("Finishing a playlist")
        assertThat(asks.ask(spotify, day, "again", t0 + min, 30)).isEqualTo(first)
        assertThat(asks.ask(TimeLimits.TOTAL, day, null, t0 + min, 120).target).isEqualTo(TimeLimits.TOTAL)
        assertThat(MoreTimeAsks(prefs).queued(day).map { it.target }).containsExactly(spotify, TimeLimits.TOTAL).inOrder()
        // A blank reason is no reason.
        assertThat(asks.ask("com.example.game", day, "   ", t0, 10).reason).isNull()
    }

    @Test
    fun `after an answer a new ask is possible, and old days are dropped`() {
        val asks = asks()
        val first = asks.ask(spotify, day, null, t0, 30)
        asks.sent(first, request("r1", MoreTimeRequest.Status.PENDING))
        asks.merge(listOf(request("r1", MoreTimeRequest.Status.APPROVED, "15", 15)), day)
        assertThat(asks.latest(spotify, day)!!.status).isEqualTo(MoreTimeAsk.Status.APPROVED)
        val second = asks.ask(spotify, day, null, t0 + 20 * min, 45)
        assertThat(second).isNotEqualTo(first)
        assertThat(asks.latest(spotify, day)).isEqualTo(second)
        asks.ask(spotify, day.plusDays(1), null, t0 + 24 * 60 * min, 30)
        assertThat(asks.all(day)).isEmpty()
        assertThat(asks.all(day.plusDays(1))).hasSize(1)
    }

    @Test
    fun `the outbox sends saved asks, keeps them offline, and marks refused ones`() {
        val asks = asks()
        val api = FakeSyncApi()
        asks.ask(spotify, day, "Finishing a playlist", t0, 30)
        api.moreTimeFailure = IOException("offline")
        assertThrows(IOException::class.java) { MoreTimeOutbox.send(asks, api, "t", day) }
        assertThat(asks.latest(spotify, day)!!.status).isEqualTo(MoreTimeAsk.Status.QUEUED)

        api.moreTimeFailure = HttpError(429, "too many")
        assertThrows(HttpError::class.java) { MoreTimeOutbox.send(asks, api, "t", day) }
        assertThat(asks.latest(spotify, day)!!.status).isEqualTo(MoreTimeAsk.Status.QUEUED)

        api.moreTimeFailure = null
        MoreTimeOutbox.send(asks, api, "t", day)
        assertThat(api.moreTimeAsked).containsExactly(spotify to "Finishing a playlist")
        assertThat(asks.latest(spotify, day)!!.status).isEqualTo(MoreTimeAsk.Status.PENDING)
        assertThat(asks.latest(spotify, day)!!.requestId).isEqualTo("r1")
        // Sent once: a second run sends nothing.
        MoreTimeOutbox.send(asks, api, "t", day)
        assertThat(api.moreTimeAsked).hasSize(1)

        asks.ask(TimeLimits.TOTAL, day, null, t0, 120)
        api.moreTimeFailure = HttpError(403, "switched off")
        MoreTimeOutbox.send(asks, api, "t", day)
        assertThat(asks.latest(TimeLimits.TOTAL, day)!!.status).isEqualTo(MoreTimeAsk.Status.UNAVAILABLE)
    }

    @Test
    fun `answers are fetched only while something waits`() {
        val asks = asks()
        val api = FakeSyncApi()
        api.moreTimeFailure = IOException("must not be called")
        MoreTimeOutbox.refresh(asks, api, "t", day)
        api.moreTimeFailure = null
        asks.sent(asks.ask(spotify, day, null, t0, 30), request("r1", MoreTimeRequest.Status.PENDING))
        api.moreTimeList = listOf(request("r1", MoreTimeRequest.Status.DECLINED, "no"), request("other", MoreTimeRequest.Status.APPROVED, "60", 60))
        MoreTimeOutbox.refresh(asks, api, "t", day)
        assertThat(asks.latest(spotify, day)!!.status).isEqualTo(MoreTimeAsk.Status.DECLINED)
        assertThat(asks.latest(spotify, day)!!.answer).isEqualTo("no")
    }

    @Test
    fun `the sync loop sends an ask saved offline`() {
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("7f1c2b9e-0000-4000-8000-000000000001", "pp_d_token")
        val api = FakeSyncApi().apply { rules = RulesResult.Changed("\"e1\"", rulesJson(timezone = "UTC")) }
        val device = FakeSyncDevice()
        val today = Instant.ofEpochMilli(device.nowMs()).atZone(java.time.ZoneOffset.UTC).toLocalDate()
        store.moreTime.ask(spotify, today, "Finishing a playlist", device.nowMs(), 30)
        SyncRunner(store, api, device).run("test")
        assertThat(api.moreTimeAsked).containsExactly(spotify to "Finishing a playlist")
        assertThat(store.moreTime.latest(spotify, today)!!.status).isEqualTo(MoreTimeAsk.Status.PENDING)
    }

    private fun request(id: String, status: MoreTimeRequest.Status, answer: String? = null, granted: Int? = null) =
        MoreTimeRequest(id, spotify, null, day, status, answer, granted, Instant.ofEpochMilli(t0), null)
}
