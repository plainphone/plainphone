// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.IOException
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

    private fun checkIn(deadlineMs: Long, sendLocation: Boolean = true, locationDue: Boolean? = null) =
        """{"id":"$id","deadline":"${iso(deadlineMs)}","callNumber":"+4512345678","sendLocation":$sendLocation""" +
            (locationDue?.let { ""","locationDue":$it""" } ?: "") + "}"

    @Test
    fun `a permanently rejected Find fix consumes its retry slot`() {
        val requested = device.now - 10 * 60_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "find", requestedAt = iso(requested)))
        api.locationFailure = IOException("offline")
        runner.run("save fix before clock correction")
        assertThat(store.pendingLocation()?.fix?.recordedAtMs).isEqualTo(device.now)

        api.rules = RulesResult.Unchanged
        api.locationFailure = HttpError(400, "recordedAt is in the future")
        runner.run("reject saved fix")
        assertThat(store.pendingLocation()).isNull()
        assertThat(store.lastFindAttempt(requested)).isEqualTo(device.now)

        api.locationFailure = null
        device.lastKnownFix = requireNotNull(device.fix).copy(recordedAtMs = device.now)
        runner = SyncRunner(SyncStore(context, FakeSecretBox()), api, device)
        runner.run("same slot")
        assertThat(api.locations).isEmpty()
        assertThat(device.locationRequests).containsExactly(true)
        device.now = requested + 15 * 60_000L
        runner.run("take a replacement fix")
        assertThat(device.locationRequests).containsExactly(true, true)
        assertThat(api.locations.single().recordedAtMs).isEqualTo(device.now)
    }

    @Test
    fun `a due check-in and pending Find retry their own uploads`() {
        val requested = device.now
        val deadline = requested + 5 * 60_000L
        val fresh = requireNotNull(device.fix)
        device.fix = null
        device.lastKnownFix = fresh.copy(recordedAtMs = requested - 40 * 60_000L)
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested), checkIn = checkIn(deadline),
        ))
        api.locationFailure = IOException("offline")
        runner.run("save Find fallback")
        assertThat(store.pendingLocation()?.fix).isEqualTo(device.lastKnownFix)
        assertThat(store.pendingLocation()?.purpose).isEqualTo("find:$requested")

        device.now = deadline
        device.fix = fresh
        api.rules = RulesResult.Changed("\"e2\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested),
            checkIn = checkIn(deadline, locationDue = true),
        ))
        runner.run("check-in is due, uploads fail")
        assertThat(store.pendingLocation()?.purpose).isEqualTo("find:$requested")
        assertThat(store.pendingLocation(checkIn = true)?.purpose).isEqualTo("checkin:$id")
        api.locationFailure = null
        api.rules = RulesResult.Unchanged
        runner = SyncRunner(SyncStore(context, FakeSecretBox()), api, device)
        runner.run("retry both uploads after restarting")
        val freshFix = fresh.copy(recordedAtMs = device.now)
        assertThat(device.freshLocationRequests).containsExactly(true, false).inOrder()
        assertThat(api.locations).containsExactly(freshFix, device.lastKnownFix, freshFix).inOrder()
        assertThat(device.positionsShown).containsExactly("checkin", "find").inOrder()
        assertThat(store.answeredLocateMs).isEqualTo(requested)
        assertThat(store.locatedCheckInId).isEqualTo(id)
        assertThat(api.locationPurposes).containsExactly("checkin:$id", "find:$requested", "find:$requested").inOrder()
    }

    @Test
    fun `check-in retries never send the cached Find position`() {
        val requested = device.now
        val deadline = requested + 5 * 60_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "checkin", requestedAt = iso(requested)))
        api.locationFailure = IOException("offline")
        runner.run("save fresh Find fix")
        device.lastKnownFix = requireNotNull(store.pendingLocation()).fix
        device.fix = null
        api.locationFailure = null
        device.now = deadline
        api.rules = RulesResult.Changed("\"e2\"", rulesJson(
            locationMode = "checkin", checkIn = checkIn(deadline, locationDue = true),
        ))
        runner.run("first check-in lookup")
        device.now = deadline + 2 * 60_000L
        api.rules = RulesResult.Unchanged
        runner = SyncRunner(SyncStore(context, FakeSecretBox()), api, device)
        runner.run("retry after restarting")

        assertThat(device.locationRequests).containsExactly(true, true, true)
        assertThat(device.freshLocationRequests).containsExactly(false, true, true).inOrder()
        assertThat(api.locations).isEmpty()
    }

    @Test
    fun `always sends the last known position when a scheduled lookup delivers no fix`() {
        val old = requireNotNull(device.fix).copy(recordedAtMs = device.now - 40 * 60_000L)
        device.fix = null
        device.lastKnownFix = old
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "always"))

        runner.run("scheduled report")

        assertThat(device.locationRequests).containsExactly(false)
        assertThat(api.locations).containsExactly(old)
        assertThat(device.positionsShown).containsExactly("always")
    }

    @Test
    fun `Find resends a pending fix near expiry when the phone clock is ahead`() {
        val requested = device.now
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "find", requestedAt = iso(requested)))
        device.now = requested + 15 * 60_000L
        api.locationFailure = IOException("offline")
        runner.run("save final fix")
        val pending = requireNotNull(store.pendingLocation())

        device.now = requested + 31 * 60_000L
        api.rules = RulesResult.Unchanged
        api.locationFailure = null
        runner.run("retry while the server still has Find open")
        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).containsExactly(pending.fix)
        assertThat(store.answeredLocateMs).isEqualTo(requested)
    }

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
    fun `a pending check-in is withheld after a local answer and cleared when rules close it`() {
        val deadline = device.now
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "checkin", checkIn = checkIn(deadline)))
        api.locationFailure = IOException("offline")
        runner.run("deadline, upload fails")
        assertThat(store.pendingLocation(checkIn = true)?.purpose).isEqualTo("checkin:$id")
        assertThat(device.locationRequests).containsExactly(true)

        api.rules = RulesResult.Unchanged
        api.locationFailure = null
        device.now += 60_000
        device.answeredCheckIns += id
        device.pendingEvents += SafetyEvent(id, "ok")
        runner.run("child answered before retry")
        assertThat(store.pendingLocation(checkIn = true)).isNotNull()
        api.rules = RulesResult.Changed("\"e2\"", rulesJson(locationMode = "checkin"))
        runner.run("server closes answered check-in")
        assertThat(store.pendingLocation(checkIn = true)).isNull()
        assertThat(api.safetyEvents).containsExactly(SafetyEvent(id, "ok"))
        assertThat(api.locations).isEmpty()
        assertThat(device.locationRequests).containsExactly(true)
    }

    @Test
    fun `check-in lookup waits for the deadline even with an early server flag`() {
        val deadline = device.now + 5 * 60_000L
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "checkin", checkIn = checkIn(deadline, locationDue = true)))
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
    fun `a saved Find upload precedes a due check-in lookup`() {
        val deadline = device.now
        val requested = deadline - 60_000L
        val saved = requireNotNull(device.fix).copy(recordedAtMs = requested)
        store.savePendingLocation(PendingLocation(saved, "find:$requested", requested))
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested),
            checkIn = checkIn(deadline, locationDue = true),
        ))
        device.beforeLocation = {
            assertThat(api.locationPurposes).containsExactly("find:$requested")
        }

        runner.run("saved Find and due check-in")

        assertThat(device.freshLocationRequests).containsExactly(true)
        assertThat(api.locationPurposes).containsExactly("find:$requested", "checkin:$id").inOrder()
        assertThat(api.locations.first()).isEqualTo(saved)
    }

    @Test
    fun `Find sends its last known fix while a due check-in has no fix`() {
        val deadline = device.now
        val requested = deadline - 1_000L
        val oldFix = requireNotNull(device.fix).copy(recordedAtMs = requested - 1)
        device.lastKnownFix = oldFix
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested),
            checkIn = checkIn(deadline, locationDue = true),
        ))
        device.beforeLocation = {
            assertThat(api.locationPurposes).containsExactly("find:$requested")
        }
        runner.run("both locations due")
        assertThat(device.freshLocationRequests).containsExactly(false, true).inOrder()
        assertThat(api.locationPurposes).containsExactly("find:$requested")
        assertThat(api.locations).containsExactly(oldFix)
        assertThat(store.lastCheckInAttempt(id)).isEqualTo(deadline)
        assertThat(store.answeredLocateMs).isNotEqualTo(requested)
    }

    @Test
    fun `Find sends a cached position after its final GPS attempt and before check-in lookup`() {
        val requested = device.now
        val deadline = requested + 20 * 60_000L
        val cached = requireNotNull(device.fix).copy(recordedAtMs = requested - 1)
        device.fix = null
        device.now = requested + 15 * 60_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested),
            checkIn = checkIn(deadline, locationDue = true),
        ))
        runner.run("final Find lookup")
        assertThat(store.lastFindAttempt(requested)).isEqualTo(device.now)
        assertThat(api.locations).isEmpty()

        device.now = deadline
        device.lastKnownFix = cached
        device.beforeLocation = {
            assertThat(api.locationPurposes).containsExactly("find:$requested")
        }
        api.rules = RulesResult.Unchanged
        runner.run("cached position arrives")
        assertThat(api.locations).containsExactly(cached)
        assertThat(device.freshLocationRequests).containsExactly(false, true).inOrder()
    }

    @Test
    fun `an older cached Find upload leaves the final GPS slot available`() {
        val requested = device.now
        device.now += 15 * 60_000L
        val cached = requireNotNull(device.fix).copy(recordedAtMs = requested - 1)
        device.lastKnownFix = cached
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "find", requestedAt = iso(requested),
        ))
        device.beforeLocation = {
            assertThat(api.locations).containsExactly(cached)
            assertThat(store.lastFindAttempt(requested)).isNull()
        }

        runner.run("cached position at the final GPS slot")

        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).containsExactly(cached, requireNotNull(device.fix).copy(recordedAtMs = device.now)).inOrder()
        assertThat(store.answeredLocateMs).isEqualTo(requested)
    }

    @Test
    fun `a slow Find preserves a due check-in lookup when the phone clock is ahead`() {
        val deadline = device.now - SyncRunner.FIND_RETRY_MS + 5_000L
        val requested = deadline - 1_000L
        api.beforeLocationUpload = { purpose ->
            val serverNow = device.now - 90_000L
            if (purpose == "checkin:$id" && serverNow >= deadline + SyncRunner.FIND_RETRY_MS) {
                throw HttpError(409, "check-in location is no longer due")
            }
        }
        device.locationDelayMs = 30_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested),
            checkIn = checkIn(deadline, locationDue = true),
        ))

        runner.run("local check-in window expires during Find")

        // The slow Find lookup also answers the check-in, whose window is still open for its upload.
        assertThat(device.freshLocationRequests).containsExactly(false)
        assertThat(api.locationPurposes).containsExactly("find:$requested", "checkin:$id").inOrder()
    }

    @Test
    fun `a slow Find does not discard a pending check-in upload`() {
        val deadline = device.now - SyncRunner.FIND_RETRY_MS + 5_000L
        val requested = device.now - 60_000L
        api.beforeLocationUpload = { purpose ->
            if (purpose == "checkin:$id" && device.now >= deadline + SyncRunner.FIND_RETRY_MS) {
                throw HttpError(409, "check-in location is no longer due")
            }
        }
        val saved = PendingLocation(requireNotNull(device.fix).copy(recordedAtMs = deadline), "checkin:$id", deadline)
        store.savePendingLocation(saved)
        device.locationDelayMs = 30_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested),
            checkIn = checkIn(deadline, locationDue = true),
        ))

        runner.run("Find consumes the remaining check-in window")

        assertThat(api.locationPurposes).containsExactly(saved.purpose, "find:$requested").inOrder()
        assertThat(api.locations.first()).isEqualTo(saved.fix)
        assertThat(device.freshLocationRequests).containsExactly(false)
    }

    @Test
    fun `new lookups send Find first when it expires first`() = assertLookupOrder(findFirst = true)

    @Test
    fun `new lookups send check-in first when it expires first`() = assertLookupOrder(findFirst = false)

    private fun assertLookupOrder(findFirst: Boolean) {
        val now = device.now
        val requested = now - if (findFirst) 120_000L else 60_000L
        val deadline = now - if (findFirst) 60_000L else 120_000L
        val expected = if (findFirst) listOf("find:$requested", "checkin:$id")
            else listOf("checkin:$id", "find:$requested")
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested),
            checkIn = checkIn(deadline, locationDue = true),
        ))
        device.beforeLocation = {
            assertThat(api.locationPurposes).containsExactlyElementsIn(
                expected.take(device.locationRequests.size),
            ).inOrder()
        }

        runner.run("both lookups due")

        // One precise lookup, made for whichever request expires first, serves both.
        assertThat(device.freshLocationRequests).containsExactly(!findFirst)
        assertThat(api.locationPurposes).containsExactlyElementsIn(expected).inOrder()
    }

    @Test
    fun `a 409 keeps a saved check-in until the next rules close it even after local expiry`() {
        val deadline = device.now - SyncRunner.FIND_RETRY_MS - 5_000L
        val saved = PendingLocation(requireNotNull(device.fix).copy(recordedAtMs = deadline), "checkin:$id", deadline)
        store.savePendingLocation(saved)
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", checkIn = checkIn(deadline, locationDue = true),
        ))
        api.locationAccepted = false
        runner.run("server still advertises check-in")
        assertThat(api.locationPurposes).containsExactly(saved.purpose)
        assertThat(store.pendingLocation(checkIn = true)).isEqualTo(saved.copy(conflict = true))

        api.rules = RulesResult.Changed("\"e2\"", rulesJson(
            locationMode = "checkin", checkIn = checkIn(deadline, locationDue = false),
        ))
        SyncRunner(SyncStore(context, FakeSecretBox()), api, device).run("server says check-in is inactive")
        assertThat(api.locationPurposes).containsExactly(saved.purpose)
        assertThat(store.pendingLocation(checkIn = true)).isNull()
    }

    @Test
    fun `a saved check-in without a 409 is kept while the server lists it as waiting`() {
        val deadline = device.now - 1_000L
        val saved = PendingLocation(requireNotNull(device.fix).copy(recordedAtMs = deadline), "checkin:$id", deadline)
        store.savePendingLocation(saved)
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", checkIn = checkIn(deadline, locationDue = false),
        ))

        runner.run("server clock has not reached the deadline")

        assertThat(api.locationPurposes).isEmpty()
        assertThat(store.pendingLocation(checkIn = true)).isEqualTo(saved)
    }

    @Test
    fun `always waits during check-in backoff and resumes at expiry`() {
        val deadline = device.now
        device.cachedLocation = requireNotNull(device.fix).copy(recordedAtMs = deadline - 1)
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "always", checkIn = checkIn(deadline)))
        runner.run("deadline")
        api.rules = RulesResult.Unchanged

        device.now = deadline + 60_000L
        runner.run("backoff")
        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).isEmpty()

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
    fun `Find and a due check-in share one precise lookup`() {
        val requested = device.now - 60_000L
        val deadline = device.now - 10_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested), checkIn = checkIn(deadline, locationDue = true),
        ))
        runner.run("both open")
        assertThat(device.locationRequests).hasSize(1)
        assertThat(api.locationPurposes).containsExactly("find:$requested", "checkin:$id")
        assertThat(api.locations.map { it.recordedAtMs }.distinct()).hasSize(1)
        assertThat(store.answeredLocateMs).isEqualTo(requested)
        assertThat(store.locatedCheckInId).isEqualTo(id)
    }

    @Test
    fun `a Find fix taken before the check-in deadline is not reused for the check-in`() {
        val requested = device.now - 60_000L
        val deadline = device.now + 5_000L
        device.fixAgeMs = 30_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested), checkIn = checkIn(deadline, locationDue = true),
        ))
        runner.run("find first")
        // The Find fix is older than the deadline, so it cannot answer the check-in.
        assertThat(api.locationPurposes).containsExactly("find:$requested")
        assertThat(store.locatedCheckInId).isNull()
    }

    @Test
    fun `a phone clock behind the server polls again when its deadline arrives`() {
        val deadline = device.now + 20_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", checkIn = checkIn(deadline, locationDue = true),
        ))
        val out = runner.run("server says due")
        assertThat(out).isEqualTo(SyncRunner.Outcome.Synced(changed = true, pollSeconds = 21))
        assertThat(api.locations).isEmpty()

        device.now = deadline + 1_000L
        api.rules = RulesResult.Unchanged
        val next = runner.run("clock caught up")
        assertThat(api.locationPurposes).containsExactly("checkin:$id")
        assertThat(next).isEqualTo(SyncRunner.Outcome.Synced(changed = false, pollSeconds = 60))
    }

    @Test
    fun `a check-in that is not due yet keeps the normal poll`() {
        val out = run {
            api.rules = RulesResult.Changed("\"e1\"", rulesJson(
                locationMode = "checkin", checkIn = checkIn(device.now + 20_000L, locationDue = false),
            ))
            runner.run("waiting")
        }
        assertThat(out).isEqualTo(SyncRunner.Outcome.Synced(changed = true, pollSeconds = 60))
    }

    @Test
    fun `a 409 after an upload whose answer was lost counts as sent`() {
        val requested = device.now - 10_000L
        val deadline = device.now - 5_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "checkin", requestedAt = iso(requested), checkIn = checkIn(deadline, locationDue = true),
        ))
        api.locationFailure = IOException("connection reset")
        runner.run("answer lost")
        assertThat(store.answeredLocateMs).isNotEqualTo(requested)

        // The retry meets 409: the first attempt had stored both fixes.
        api.locationFailure = null
        api.locationAccepted = false
        api.rules = RulesResult.Unchanged
        runner.run("retry")
        assertThat(store.answeredLocateMs).isEqualTo(requested)
        assertThat(store.locatedCheckInId).isEqualTo(id)
        assertThat(device.positionsShown).containsExactly("checkin", "find")
    }

    @Test
    fun `a 409 after a failure that never reached the server is still a refusal`() {
        val requested = device.now - 10_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "find", requestedAt = iso(requested)))
        api.locationFailure = java.net.ConnectException("no route")
        runner.run("offline")
        api.locationFailure = null
        api.locationAccepted = false
        api.rules = RulesResult.Unchanged
        runner.run("retry")
        assertThat(store.answeredLocateMs).isNotEqualTo(requested)
        assertThat(device.positionsShown).isEmpty()
    }

    @Test
    fun `a 409 without an earlier lost answer is still a refusal`() {
        val requested = device.now - 10_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "find", requestedAt = iso(requested)))
        api.locationAccepted = false
        runner.run("refused")
        assertThat(store.answeredLocateMs).isNotEqualTo(requested)
        assertThat(device.positionsShown).isEmpty()
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
