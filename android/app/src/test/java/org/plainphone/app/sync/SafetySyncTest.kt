// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

/** Location modes, "Ring the phone" and "Are you okay?" in the sync (docs/location.md). */
@RunWith(RobolectricTestRunner::class)
class SafetySyncTest {
    private val context = ApplicationProvider.getApplicationContext<android.app.Application>()
    private lateinit var store: SyncStore
    private lateinit var api: FakeSyncApi
    private lateinit var device: FakeSyncDevice
    private lateinit var runner: SyncRunner

    @Before
    fun setUp() {
        store = SyncStore(context, FakeSecretBox())
        api = FakeSyncApi()
        device = FakeSyncDevice()
        runner = SyncRunner(store, api, device)
        store.savePaired("phone-1", "pp_d_token")
    }

    private fun iso(ms: Long) = Instant.ofEpochMilli(ms).toString()
    private val id = "0d8f6c1e-1111-4111-8111-111111111111"

    private fun checkIn(deadlineMs: Long, sendLocation: Boolean = true) =
        """{"id":"$id","deadline":"${iso(deadlineMs)}","callNumber":"+4512345678","sendLocation":$sendLocation}"""

    @Test
    fun `older servers without modes keep the 5-minute reports`() {
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = null))
        runner.run("test")
        assertThat(store.rules()!!.locationMode).isEqualTo(ServerRules.LOCATION_ALWAYS)
        assertThat(api.locations).hasSize(1)
        assertThat(device.positionsShown).containsExactly("always") // logged; its notice is the ongoing one
    }

    @Test
    fun `an unknown mode from a newer server never means more sharing`() {
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "sometimes"))
        runner.run("test")
        assertThat(store.rules()!!.locationMode).isEqualTo(ServerRules.LOCATION_FIND)
        assertThat(api.locations).isEmpty()
    }

    @Test
    fun `outside always the phone sends only when asked, and says so`() {
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "checkin"))
        runner.run("test")
        device.now += 60 * 60_000L
        runner.run("an hour later")
        assertThat(api.locations).isEmpty()

        api.rules = RulesResult.Changed("\"e2\"", rulesJson(locationMode = "checkin", requestedAt = iso(device.now)))
        runner.run("find")
        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).hasSize(1)
        assertThat(device.positionsShown).containsExactly("find")
    }

    @Test
    fun `retries of one Find with an old fix are one line and one notice for the child`() {
        device.fixAgeMs = 10 * 60_000L // indoors: only an older last-known position
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "find", requestedAt = iso(device.now)))
        runner.run("find")
        val requested = device.now
        for (minute in listOf(2, 5)) {
            device.now = requested + minute * 60_000L
            runner.run("retry")
        }
        assertThat(api.locations).hasSize(3)
        assertThat(device.positionsShown).containsExactly("find")
    }

    @Test
    fun `always stops at its end time even before the server says so`() {
        val mode = "always\",\"alwaysUntil\":\"${iso(device.now + 10 * 60_000L)}"
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = mode))
        runner.run("test")
        assertThat(api.locations).hasSize(1)
        device.now += 15 * 60_000L
        runner.run("after the end")
        assertThat(api.locations).hasSize(1)
    }

    @Test
    fun `an unanswered check-in sends one precise position after the deadline, once`() {
        val deadline = device.now + 5 * 60_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "checkin", checkIn = checkIn(deadline)))
        runner.run("asked")
        assertThat(device.safetyRules.last().checkIn!!.callNumber).isEqualTo("+4512345678")
        assertThat(api.locations).isEmpty()

        device.now = deadline
        api.rules = RulesResult.Unchanged
        runner.run("deadline")
        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).hasSize(1)
        assertThat(device.positionsShown).containsExactly("checkin")

        device.now += 60_000L
        runner.run("again")
        assertThat(api.locations).hasSize(1)
    }

    @Test
    fun `indoor check-in uses the same five offsets starting at the deadline`() {
        val deadline = device.now + 5 * 60_000L
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "checkin", checkIn = checkIn(deadline)))
        val attempts = (-1..30).filter { minute ->
            device.now = deadline + minute * 60_000L
            val before = device.locationRequests.size
            runner.run("indoor")
            api.rules = RulesResult.Unchanged
            device.locationRequests.size > before
        }
        assertThat(attempts).containsExactly(0, 2, 5, 10, 15).inOrder()
        assertThat(device.locationRequests).containsExactly(true, true, true, true, true)
    }

    @Test
    fun `always waits during check-in backoff and resumes at expiry`() {
        val deadline = device.now
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "always", checkIn = checkIn(deadline)))
        runner.run("deadline")
        api.rules = RulesResult.Unchanged

        device.now = deadline + 60_000L
        runner.run("backoff")
        assertThat(device.locationRequests).containsExactly(true)

        device.now = deadline + SyncRunner.FIND_RETRY_MS
        runner.run("expired")
        assertThat(device.locationRequests).containsExactly(true, false).inOrder()
    }

    @Test
    fun `an answer is sent first and no position follows`() {
        val deadline = device.now + 5 * 60_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "checkin", checkIn = checkIn(deadline)))
        runner.run("asked")
        // The child taps "Yes, I'm okay" while offline; the server hears it at the next sync.
        device.answeredCheckIns += id
        device.pendingEvents += SafetyEvent(id, "ok")
        device.now = deadline + 1_000L
        api.rules = RulesResult.Unchanged
        runner.run("back online")
        assertThat(api.safetyEvents).containsExactly(SafetyEvent(id, "ok"))
        assertThat(device.pendingEvents).isEmpty()
        assertThat(api.locations).isEmpty()
    }

    @Test
    fun `no position for a check-in when the mode does not send one`() {
        val deadline = device.now - 1_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "find", checkIn = checkIn(deadline, sendLocation = false)))
        runner.run("late")
        assertThat(api.locations).isEmpty()
    }

    @Test
    fun `a ring reaches the phone and the poll gets fast`() {
        val ring = """{"id":"$id","endsAt":"${iso(device.now + 300_000L)}","stopOnAnswer":false,"answered":true}"""
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(ring = ring).replace("\"pollSeconds\":60", "\"pollSeconds\":10"))
        val out = runner.run("ring")
        assertThat(out).isEqualTo(SyncRunner.Outcome.Synced(changed = true, pollSeconds = 10))
        assertThat(device.safetyRules.last().ring).isEqualTo(RingRequest(id, Instant.ofEpochMilli(device.now + 300_000L), stopOnAnswer = false, answered = true))
    }
}
