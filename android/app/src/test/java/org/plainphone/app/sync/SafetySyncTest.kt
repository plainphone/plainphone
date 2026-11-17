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
