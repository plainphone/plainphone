// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.DeviceContact
import org.plainphone.app.StepResult
import org.plainphone.app.light.FilterHealth
import org.plainphone.app.light.FilterMethod
import org.plainphone.app.light.LightSetup
import org.plainphone.app.contacts.SyncedContactPolicySource
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SyncRunnerTest {
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
    }

    private fun pair() = store.savePaired("7f1c2b9e-0000-4000-8000-000000000001", "pp_d_token")

    @Test
    fun `nothing happens before pairing`() {
        assertThat(runner.run("test")).isEqualTo(SyncRunner.Outcome.NotPaired)
        assertThat(api.tokensUsed).isEmpty()
    }

    @Test
    fun `the token is stored sealed and used`() {
        pair()
        assertThat(context.getSharedPreferences(SyncStore.PREFS, 0).getString("device_token", null)).doesNotContain("pp_d_token")
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        runner.run("test")
        assertThat(api.tokensUsed).containsExactly("pp_d_token")
    }

    @Test
    fun `the server's clock reaches the trusted time before the lock is applied`() {
        pair()
        api.serverTime = ServerTime(serverMs = 1_900_000_000_000L, elapsedMs = 12_345L)
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        runner.run("test")
        assertThat(device.serverTimes).containsExactly(api.serverTime)
        assertThat(device.appliedAfterServerTime).isTrue()
        // A failed fetch whose answer still came from the server keeps the clock too.
        api.failRules = HttpError(503, "busy")
        runner.run("again")
        assertThat(device.serverTimes).hasSize(2)
    }

    @Test
    fun `new rules are stored and applied, then polled with their ETag`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        val out = runner.run("test")
        assertThat(out).isEqualTo(SyncRunner.Outcome.Synced(changed = true, pollSeconds = 60))
        assertThat(store.rules()!!.allowedApps).contains("com.spotify.music")
        assertThat(device.applies.single()).startsWith("new rules")

        api.rules = RulesResult.Unchanged
        assertThat(runner.run("again")).isEqualTo(SyncRunner.Outcome.Synced(changed = false, pollSeconds = 60))
        assertThat(api.etagsSent).containsExactly(null, "\"e1\"").inOrder()
    }

    @Test
    fun `offline keeps the last rules and still enforces them`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        runner.run("test")
        api.failRules = IOException("no network")
        val out = runner.run("offline")
        assertThat(out).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(store.rules()!!.contacts).containsExactly(ApprovedContact("Mum", "+4512345678"))
        assertThat(store.etag).isEqualTo("\"e1\"")
        assertThat(device.applies.last()).contains("last rules")
    }

    @Test
    fun `a broken answer never replaces good rules`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        runner.run("test")
        api.rules = RulesResult.Changed("\"e2\"", """{"apps":"everything"}""")
        assertThat(runner.run("garbage")).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(store.etag).isEqualTo("\"e1\"")
        assertThat(store.rules()!!.hiddenApps).containsExactly("com.example.game")
    }

    @Test
    fun `removed in the dashboard keeps the last rules and stops polling`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        runner.run("test")
        api.rules = RulesResult.Unpaired
        assertThat(runner.run("removed")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(store.removed).isTrue()
        assertThat(store.isPaired).isFalse()
        assertThat(store.everPaired).isTrue()
        assertThat(store.rules()).isNotNull()
        val calls = api.tokensUsed.size
        assertThat(runner.run("later")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(api.tokensUsed).hasSize(calls)
    }

    @Test
    fun `suggestions require consent and are capped and throttled`() {
        pair()
        val first = DeviceContact("Alex", List(101) { "+451234${1000 + it}" })
        var addressBook = listOf(first) + List(2000) { DeviceContact("Contact $it", listOf("+453456${1000 + it}")) }
        var reads = 0
        val source = object : SyncDevice by device {
            override fun contactSuggestions(): List<DeviceContact> {
                reads++
                return addressBook
            }
        }
        val sync = SyncRunner(store, api, source)
        fun rules(enabled: Boolean) = org.json.JSONObject(rulesJson()).put("suggestDeviceContacts", enabled).toString()
        api.rules = RulesResult.Changed("legacy", rulesJson())
        sync.run("legacy server")
        api.rules = RulesResult.Changed("off", rules(false))
        sync.run("off")
        assertThat(reads).isEqualTo(0)
        assertThat(api.contactSnapshots).isEmpty()

        api.rules = RulesResult.Changed("on", rules(true))
        sync.run("on")
        assertThat(api.contactSnapshots.single()).containsExactlyElementsIn(addressBook.take(2_000))
        api.rules = RulesResult.Unchanged
        addressBook = emptyList()
        device.now += 6 * 60 * 60_000L - 1
        SyncRunner(store, api, source).run("before refresh")
        assertThat(reads).isEqualTo(1)
        device.now++
        sync.run("refresh")
        assertThat(reads).isEqualTo(2)
        assertThat(api.contactSnapshots.last()).isEmpty()

        api.rules = RulesResult.Changed("off-again", rules(false))
        device.now += 6 * 60 * 60_000L
        sync.run("disabled again")
        assertThat(reads).isEqualTo(2)
        assertThat(api.contactSnapshots).hasSize(2)
    }

    @Test
    fun `a failed suggestion upload retries without reading contacts again`() {
        pair()
        val snapshot = listOf(DeviceContact("Alex", listOf("+4512345678")))
        var reads = 0
        val source = object : SyncDevice by device {
            override fun contactSuggestions(): List<DeviceContact> {
                reads++
                return snapshot
            }
        }
        api.rules = RulesResult.Changed("on", org.json.JSONObject(rulesJson())
            .put("suggestDeviceContacts", true).toString())
        api.contactSuggestionsFailure = IOException("offline")
        SyncRunner(store, api, source).run("upload interrupted")
        assertThat(reads).isEqualTo(1)
        assertThat(api.contactSnapshots).isEmpty()

        api.rules = RulesResult.Unchanged
        api.contactSuggestionsFailure = null
        SyncRunner(store, api, source).run("retry upload with a new runner")
        SyncRunner(store, api, source).run("after upload")
        assertThat(reads).isEqualTo(1)
        assertThat(api.contactSnapshots).containsExactly(snapshot)
    }

    /** Uploads once with [status] as the answer, syncs again, and returns the uploads that went through. */
    private fun uploadsAfterRejection(status: Int): List<List<DeviceContact>> {
        pair()
        val snapshot = listOf(DeviceContact("Alex", listOf("+4512345678")))
        val source = object : SyncDevice by device {
            override fun contactSuggestions() = snapshot
        }
        api.rules = RulesResult.Changed("on", org.json.JSONObject(rulesJson())
            .put("suggestDeviceContacts", true).toString())
        api.contactSuggestionsFailure = HttpError(status, "rejected")
        SyncRunner(store, api, source).run("upload rejected")
        api.rules = RulesResult.Unchanged
        api.contactSuggestionsFailure = null
        SyncRunner(store, api, source).run("next sync")
        return api.contactSnapshots.toList()
    }

    @Test
    fun `a permanent rejection of the suggestion upload is not resent`() {
        assertThat(uploadsAfterRejection(400)).isEmpty()
    }

    @Test
    fun `a rate limited suggestion upload is kept and resent`() {
        assertThat(uploadsAfterRejection(429)).containsExactly(listOf(DeviceContact("Alex", listOf("+4512345678"))))
        assertThat(uploadsAfterRejection(408)).containsExactly(listOf(DeviceContact("Alex", listOf("+4512345678"))))
    }

    @Test
    fun `turning off suggestions discards a failed upload`() {
        pair()
        var addressBook = listOf(DeviceContact("Alex", listOf("+4512345678")))
        val source = object : SyncDevice by device {
            override fun contactSuggestions() = addressBook
        }
        fun rules(enabled: Boolean) = org.json.JSONObject(rulesJson()).put("suggestDeviceContacts", enabled).toString()
        api.rules = RulesResult.Changed("on", rules(true))
        api.contactSuggestionsFailure = IOException("offline")
        SyncRunner(store, api, source).run("upload interrupted")

        api.contactSuggestionsFailure = null
        api.rules = RulesResult.Changed("off", rules(false))
        SyncRunner(store, api, source).run("consent withdrawn")
        assertThat(api.contactSnapshots).isEmpty()

        addressBook = emptyList()
        api.rules = RulesResult.Changed("on-again", rules(true))
        SyncRunner(store, api, source).run("consent restored")
        assertThat(api.contactSnapshots.single()).isEmpty()
    }

    @Test
    fun `a light child phone enforces contacts only with an explicit flag`() {
        pair()
        LightSetup.markComplete(context)
        val source = SyncedContactPolicySource(context)
        val rules = org.json.JSONObject(rulesJson(contacts = "[]")).put("mode", "light")
        store.saveRules("legacy", rules.toString(), device.now)
        assertThat(source.rules().enforced).isFalse()
        store.saveRules("off", rules.put("lightContactRestriction", false).toString(), device.now)
        assertThat(source.rules().enforced).isFalse()
        store.saveRules("on", rules.put("lightContactRestriction", true).toString(), device.now)
        assertThat(source.rules().enforced).isTrue()
    }

    @Test
    fun `apps are reported once, and again when they change`() {
        pair()
        runner.run("1")
        runner.run("2")
        assertThat(api.appsReported).hasSize(1)
        device.apps = device.apps + InstalledApp("com.example.new", "New", core = false)
        store.markAppsDirty()
        runner.run("3")
        assertThat(api.appsReported).hasSize(2)
        assertThat(api.appsReported.last().map { it.packageName }).contains("com.example.new")
    }

    @Test
    fun `a quiet sync only fetches rules and skips the app scan`() {
        pair()
        store.saveRules("e1", rulesJson(locationEnabled = false), device.now)
        runner.run("first report")
        api.etagsSent.clear()
        api.appsReported.clear()
        api.statuses.clear()
        device.installedAppsCalls = 0
        device.now += 60_000

        runner.run("unchanged")

        assertThat(device.installedAppsCalls).isEqualTo(0)
        assertThat(api.etagsSent).hasSize(1)
        assertThat(api.appsReported).isEmpty()
        assertThat(api.statuses).isEmpty()
        assertThat(api.locations).isEmpty()
        assertThat(api.safetyEvents).isEmpty()
        assertThat(api.acks).isEmpty()
    }

    @Test
    fun `changing enabled keyboards refreshes core flags with unchanged rules`() {
        pair()
        val keyboard = InstalledApp("com.example.keyboard", "Keyboard", core = false)
        device.apps = listOf(keyboard)
        runner.run("initial inventory")
        api.rules = RulesResult.Unchanged

        val coreKeyboard = keyboard.copy(core = true)
        device.apps = listOf(coreKeyboard)
        device.dynamicCorePackages = setOf(keyboard.packageName)
        runner.run("enabled keyboard")
        runner.run("same keyboard")

        device.apps = listOf(keyboard)
        device.dynamicCorePackages = emptySet()
        runner.run("disabled keyboard")

        assertThat(api.appsReported).containsExactly(listOf(keyboard), listOf(coreKeyboard), listOf(keyboard)).inOrder()
        assertThat(device.installedAppsCalls).isEqualTo(3)
    }

    @Test
    fun `a change during an upload is still reported on the next sync`() {
        pair()
        runner.run("initial inventory")
        val originalApps = device.apps
        device.apps += InstalledApp("com.example.new", "New", core = false)
        store.markAppsDirty()
        api.onReportApps = {
            device.apps = originalApps
            store.markAppsDirty()
        }
        runner.run("installed")
        api.onReportApps = null

        runner.run("uninstalled")

        assertThat(api.appsReported).hasSize(3)
        assertThat(api.appsReported.last()).isEqualTo(originalApps)
    }

    @Test
    fun `a failed upload stays dirty and the same inventory is rescanned after a day`() {
        pair()
        api.onReportApps = { throw IOException("offline") }
        runner.run("failed inventory")
        api.onReportApps = null
        runner.run("retry inventory")
        assertThat(device.installedAppsCalls).isEqualTo(2)
        assertThat(api.appsReported).hasSize(1)

        device.now += 24 * 60 * 60_000L
        runner.run("daily rescan")
        assertThat(device.installedAppsCalls).isEqualTo(3)
        assertThat(api.appsReported).hasSize(1)
    }

    @Test
    fun `Find is answered once with a precise position`() {
        pair()
        device.now = java.time.Instant.parse("2027-01-04T10:01:00Z").toEpochMilli()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(requestedAt = "2027-01-04T10:00:00.000Z"))
        runner.run("find")
        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).hasSize(1)
        // Same request still in the rules: not answered again until the regular interval.
        api.rules = RulesResult.Unchanged
        device.now += 60_000
        runner.run("again")
        assertThat(device.locationRequests).containsExactly(true)
        // The regular report comes after intervalMinutes, coarse.
        device.now += 5 * 60_000
        runner.run("later")
        assertThat(device.locationRequests).containsExactly(true, false).inOrder()
    }

    @Test
    fun `an old last-known position does not answer Find, so the phone keeps trying`() {
        pair()
        device.now = java.time.Instant.parse("2027-01-04T10:05:00Z").toEpochMilli()
        device.fixAgeMs = 60 * 60_000 // from 09:05, before the parent pressed Find at 10:00
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(requestedAt = "2027-01-04T10:00:00.000Z"))
        runner.run("find, stale")
        assertThat(api.locations).hasSize(1)
        api.rules = RulesResult.Unchanged
        device.now += 5 * 60_000
        device.fixAgeMs = 0
        runner.run("find, fresh")
        assertThat(device.locationRequests).containsExactly(true, true).inOrder()
        assertThat(api.locations).hasSize(2)
        device.now += 60_000
        runner.run("answered")
        assertThat(device.locationRequests).hasSize(2)
    }

    @Test
    fun `Find sends the last known position with its original time when the lookup fails`() {
        pair()
        val requested = device.now
        val old = requireNotNull(device.fix).copy(recordedAtMs = requested - 40 * 60_000L)
        device.fix = null
        device.lastKnownFix = old
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "find",
            requestedAt = java.time.Instant.ofEpochMilli(requested).toString(),
        ))
        runner.run("no fix at first attempt")
        assertThat(api.locations).containsExactly(old)
        assertThat(store.answeredLocateMs).isNotEqualTo(requested)
        api.rules = RulesResult.Unchanged

        val newer = old.copy(recordedAtMs = requested - 5 * 60_000L)
        device.lastKnownFix = newer
        device.now = requested + 15 * 60_000L
        runner.run("no fix at last attempt")
        assertThat(api.locations).containsExactly(old, newer).inOrder()
        assertThat(store.answeredLocateMs).isNotEqualTo(requested)
        assertThat(device.positionsShown).containsExactly("find")
    }

    @Test
    fun `a failed fifth Find upload is retried after reopening the store without another lookup`() {
        pair()
        val requested = device.now
        val fix = requireNotNull(device.fix)
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "find",
            requestedAt = java.time.Instant.ofEpochMilli(requested).toString(),
        ))
        for (minute in listOf(0, 2, 5, 10)) {
            device.now = requested + minute * 60_000L
            runner.run("no fix")
            api.rules = RulesResult.Unchanged
        }

        device.now = requested + 15 * 60_000L
        val expected = fix.copy(recordedAtMs = device.now)
        device.fix = fix
        api.locationFailure = IOException("offline")
        runner.run("fifth attempt, upload fails")
        assertThat(api.locations).isEmpty()
        assertThat(device.locationRequests).hasSize(5)
        assertThat(store.lastFindAttempt(requested)).isEqualTo(requested + 10 * 60_000L)

        device.now += 60_000
        device.fix = null
        api.locationFailure = null
        val reopened = SyncStore(context, FakeSecretBox())
        SyncRunner(reopened, api, device).run("retry upload")
        assertThat(api.locations).containsExactly(expected)
        assertThat(device.locationRequests).hasSize(5)
        assertThat(reopened.answeredLocateMs).isEqualTo(requested)
    }

    @Test
    fun `Find starts when the phone clock is behind and keeps the first slot used`() {
        pair()
        val requested = device.now + 120_000L
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "find",
            requestedAt = java.time.Instant.ofEpochMilli(requested).toString(),
        ))
        runner.run("clock behind")
        assertThat(device.locationRequests).containsExactly(true)
        api.rules = RulesResult.Unchanged
        device.now = requested
        runner.run("clock caught up")
        assertThat(device.locationRequests).containsExactly(true)
    }

    @Test
    fun `indoor Find attempts only at the five planned offsets`() {
        pair()
        val requested = java.time.Instant.ofEpochMilli(device.now)
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationMode = "find", requestedAt = requested.toString()))
        val attempts = (0..30).filter { minute ->
            device.now = requested.toEpochMilli() + minute * 60_000L
            val before = device.locationRequests.size
            // A new runner and store must pick up the same retry schedule.
            SyncRunner(SyncStore(context, FakeSecretBox()), api, device).run("indoor")
            api.rules = RulesResult.Unchanged
            device.locationRequests.size > before
        }
        assertThat(attempts).containsExactly(0, 2, 5, 10, 15).inOrder()
        assertThat(device.locationRequests).containsExactly(true, true, true, true, true)
    }

    @Test
    fun `a coarse post-request cache does not skip the precise Find lookup`() {
        pair()
        val requested = device.now
        val precise = requireNotNull(device.fix).copy(recordedAtMs = requested)
        device.lastKnownFix = precise.copy(accuracyM = 2_000f)
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "find",
            requestedAt = java.time.Instant.ofEpochMilli(requested).toString(),
        ))

        runner.run("Find with a coarse cached fix")

        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).containsExactly(precise)
        assertThat(store.answeredLocateMs).isEqualTo(requested)
    }

    @Test
    fun `a two minute old post-request cache does not skip the precise Find lookup`() {
        pair()
        val requested = device.now
        val cached = requireNotNull(device.fix).copy(recordedAtMs = requested)
        device.lastKnownFix = cached
        device.now += 2 * 60_000L
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "find",
            requestedAt = java.time.Instant.ofEpochMilli(requested).toString(),
        ))

        runner.run("Find with a stale cached fix")

        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).containsExactly(cached.copy(recordedAtMs = device.now))
    }

    @Test
    fun `a post-request cache older than two minutes is still sent when the Find lookup has no fix`() {
        pair()
        val requested = device.now
        val cached = requireNotNull(device.fix).copy(recordedAtMs = requested + 1_000L)
        device.fix = null
        device.lastKnownFix = cached
        device.now = cached.recordedAtMs + 2 * 60_000L + 1
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "find",
            requestedAt = java.time.Instant.ofEpochMilli(requested).toString(),
        ))

        runner.run("Find with only a stale cached fix")

        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).containsExactly(cached)
        assertThat(store.answeredLocateMs).isEqualTo(requested)
    }

    @Test
    fun `a coarse post-request cache is still sent when the Find lookup has no fix`() {
        pair()
        val requested = device.now
        val cached = requireNotNull(device.fix).copy(recordedAtMs = requested, accuracyM = 2_000f)
        device.fix = null
        device.lastKnownFix = cached
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(
            locationMode = "find",
            requestedAt = java.time.Instant.ofEpochMilli(requested).toString(),
        ))

        runner.run("Find with only a coarse cached fix")

        assertThat(device.locationRequests).containsExactly(true)
        assertThat(api.locations).containsExactly(cached)
        assertThat(store.answeredLocateMs).isEqualTo(requested)
    }

    @Test
    fun `always reports cached positions during Find backoff without starting a lookup`() {
        pair()
        val fix = requireNotNull(device.fix).copy(recordedAtMs = device.now - 1)
        device.fix = null
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(requestedAt = java.time.Instant.ofEpochMilli(device.now).toString()))
        runner.run("initial Find with no fix")
        api.rules = RulesResult.Unchanged

        device.now += 30_000
        runner.run("always with no cached fix")
        assertThat(api.locations).isEmpty()

        device.cachedLocation = fix
        device.now += 30_000
        runner.run("always with an older cached fix")
        assertThat(api.locations).containsExactly(fix)
        assertThat(device.locationRequests).containsExactly(true)
        assertThat(device.positionsShown).containsExactly("always")

        device.now += 60_000
        runner.run("second Find attempt")
        assertThat(device.locationRequests).containsExactly(true, true)
    }

    @Test
    fun `an unanswerable Find is given up after the expiry grace period`() {
        pair()
        val pressed = java.time.Instant.parse("2027-01-04T10:00:00Z").toEpochMilli()
        device.now = pressed + 32 * 60_000
        device.fixAgeMs = 2 * 60 * 60_000
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(requestedAt = "2027-01-04T10:00:00.000Z"))
        runner.run("late")
        // Only the regular coarse report, no precise attempt.
        assertThat(device.locationRequests).containsExactly(false)
    }

    @Test
    fun `removal re-applies the lock at once so DNS falls back`() {
        pair()
        api.rules = RulesResult.Unpaired
        runner.run("removed")
        assertThat(device.applies.single()).contains("removed")
    }

    @Test
    fun `no position is sent when the parent turned location off`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationEnabled = false, requestedAt = "2027-01-04T10:00:00.000Z"))
        runner.run("off")
        assertThat(device.locationRequests).isEmpty()
        assertThat(api.locations).isEmpty()
    }

    @Test
    fun `receipts are only sent for applied rules and can be turned off with the filter check`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        device.lock = device.lock.copy(webFilterActive = true, protections = mapOf(
            "usageAccess" to true, "usageAccessGranted" to false,
        ))
        runner.run("fetched without applying")
        assertThat(api.statuses.last().rulesEtag).isNull()
        assertThat(api.statuses.last().webFilterActive).isTrue()
        assertThat(api.statuses.last().protections).containsEntry("usageAccessGranted", false)

        device.lock = device.lock.copy(receipt = AppliedRulesReceipt("\"e1\"", device.now))
        api.rules = RulesResult.Unchanged
        runner.run("applied")
        assertThat(api.statuses.last().rulesEtag).isEqualTo("\"e1\"")
        assertThat(api.statuses.last().rulesAppliedAtMs).isEqualTo(device.now)

        val disabled = org.json.JSONObject(rulesJson())
            .put("changeReceiptsEnabled", false).put("healthBoardEnabled", false)
        api.rules = RulesResult.Changed("\"e2\"", disabled.toString())
        device.lock = device.lock.copy(receipt = AppliedRulesReceipt("\"e2\"", device.now))
        runner.run("disabled")
        assertThat(api.statuses.last().rulesEtag).isNull()
        assertThat(api.statuses.last().rulesAppliedAtMs).isNull()
        assertThat(api.statuses.last().webFilterActive).isNull()
        assertThat(api.statuses.last().protections).containsExactly("usageAccess", true)
        assertThat(api.statuses.last().lockIntact).isTrue()
    }

    @Test
    fun `the status says where the app came from, and an app that does not know leaves it out`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        device.distribution = "play"
        runner.run("play")
        assertThat(api.statuses.last().distribution).isEqualTo("play")
        assertThat(api.statuses.last().toJson().getString("distribution")).isEqualTo("play")

        val older = api.statuses.last().copy(distribution = null)
        assertThat(older.toJson().has("distribution")).isFalse()
    }

    @Test
    fun `a new Private DNS filter is only confirmed once the phone has verified it`() {
        pair()
        device.lock = device.lock.copy(mode = "light")
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(filterMethod = "privateDns"))
        device.lock = device.lock.copy(
            receipt = AppliedRulesReceipt("\"e1\"", device.now),
            filter = FilterHealth(FilterMethod.PRIVATE_DNS, false, "unverified"),
        )
        runner.run("applied, not verified")
        assertThat(api.statuses.last().rulesEtag).isNull()
        assertThat(api.statuses.last().rulesReceiptConfirmed).isFalse()

        device.lock = device.lock.copy(filter = FilterHealth(FilterMethod.PRIVATE_DNS, true))
        api.rules = RulesResult.Unchanged
        runner.run("verified")
        assertThat(api.statuses.last().rulesEtag).isEqualTo("\"e1\"")

        // A later rule change is confirmed even while the filter has a problem: the phone applied it.
        api.rules = RulesResult.Changed("\"e2\"", rulesJson(filterMethod = "privateDns", locationEnabled = false))
        device.lock = device.lock.copy(
            receipt = AppliedRulesReceipt("\"e2\"", device.now),
            filter = FilterHealth(FilterMethod.PRIVATE_DNS, false, "unverified"),
        )
        runner.run("unrelated change")
        assertThat(api.statuses.last().rulesEtag).isEqualTo("\"e2\"")
    }

    @Test
    fun `rules from an older server keep the legacy protection report`() {
        pair()
        val legacy = org.json.JSONObject(rulesJson()).apply { remove("healthBoardEnabled") }
        api.rules = RulesResult.Changed("\"old\"", legacy.toString())
        device.lock = device.lock.copy(protections = mapOf("usageAccess" to true, "usageAccessGranted" to false))
        runner.run("legacy server")
        assertThat(api.statuses.last().protections).containsExactly("usageAccess", true)
    }

    @Test
    fun `status goes out at once when the lock changes, otherwise every 15 minutes`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        device.lock = device.lock.copy(receipt = AppliedRulesReceipt("\"e1\"", device.now))
        runner.run("1")
        assertThat(api.statuses).hasSize(1)
        assertThat(api.statuses[0].lockIntact).isTrue()
        assertThat(api.statuses[0].rulesEtag).isEqualTo("\"e1\"")
        assertThat(api.statuses[0].batteryPct).isEqualTo(64)

        api.rules = RulesResult.Unchanged
        device.now += 60_000
        runner.run("2")
        assertThat(api.statuses).hasSize(1)

        val batteryPolicy = "battery exemption missing: self-update cannot run"
        device.lock = device.lock.copy(failedPolicies = listOf(batteryPolicy))
        runner.run("battery exemption removed")
        assertThat(api.statuses.last().failedPolicies).containsExactly(batteryPolicy)
        assertThat(api.statuses.last().lockIntact).isTrue()

        device.lock = device.lock.copy(failedPolicies = listOf(batteryPolicy, "private DNS"))
        runner.run("3")
        assertThat(api.statuses).hasSize(3)
        assertThat(api.statuses.last().lockIntact).isFalse()
        assertThat(api.statuses.last().failedPolicies).containsExactly(batteryPolicy, "private DNS")

        device.now += SyncRunner.STATUS_EVERY_MS
        runner.run("4")
        assertThat(api.statuses).hasSize(4)
    }

    @Test
    fun `call role and parallel apps notices leave the lock intact`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        device.lock = device.lock.copy(callRoleActionNeeded = true)
        store.statusNotices.record(StatusNotices.PARALLEL_APPS_REMOVED)
        runner.run("status")

        val status = api.statuses.single()
        assertThat(status.lockIntact).isTrue()
        assertThat(status.failedPolicies).isEmpty()
        assertThat(status.toJson().getBoolean("callRoleActionNeeded")).isTrue()
        assertThat(status.toJson().getBoolean("parallelAppsRemoved")).isTrue()
        assertThat(store.statusNotices.pending(StatusNotices.PARALLEL_APPS_REMOVED)).isNull()
        runner.run("acknowledged")
        assertThat(api.statuses.last().toJson().has("parallelAppsRemoved")).isFalse()
    }

    @Test
    fun `a failing report never stops the rules`() {
        pair()
        val failing = object : SyncApi by api {
            override fun reportApps(token: String, apps: List<InstalledApp>) = throw IOException("boom")
            override fun reportStatus(token: String, status: DeviceStatus) = throw IOException("boom")
        }
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        val out = SyncRunner(store, failing, device).run("test")
        assertThat(out).isEqualTo(SyncRunner.Outcome.Synced(changed = true, pollSeconds = 60))
        assertThat(store.rules()).isNotNull()
    }

    @Test
    fun `contacts come from the dashboard once rules arrived, and cannot be edited on the phone`() {
        val source = SyncedContactPolicySource(context) { store.rules()?.contacts }
        source.add(ApprovedContact("Local", "+4511111111")).getOrThrow()
        assertThat(source.managedRemotely).isFalse()
        assertThat(source.rules().contacts.map { it.name }).containsExactly("Local")

        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        runner.run("test")
        assertThat(source.managedRemotely).isTrue()
        assertThat(source.rules().contacts).containsExactly(ApprovedContact("Mum", "+4512345678"))
        assertThat(source.add(ApprovedContact("Sneaky", "+4599999999")).isFailure).isTrue()
        assertThat(source.rules().contacts.map { it.name }).containsExactly("Mum")
    }

    // --- Released by a parent (docs/sync-api.md, "Releasing the phone") ---------------------

    @Test
    fun `a release switches Plainphone off before the lock, tells the server and ends as removed`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(release = true))
        assertThat(runner.run("release")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(device.releases).isEqualTo(1)
        assertThat(api.acks).containsExactly("pp_d_token")
        // The lock is never applied for these rules, and nothing is reported to the parent.
        assertThat(device.applies).isEmpty()
        assertThat(api.statuses).isEmpty()
        assertThat(api.locations).isEmpty()
        assertThat(store.released).isTrue()
        assertThat(store.removed).isTrue()
        assertThat(store.isPaired).isFalse()
        // Nothing more happens afterwards.
        val calls = api.tokensUsed.size
        assertThat(runner.run("later")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(api.tokensUsed).hasSize(calls)
        assertThat(device.releases).isEqualTo(1)
    }

    @Test
    fun `rules kept from an earlier pairing never release a phone paired again`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(release = true))
        device.releaseResults = listOf(StepResult("give up Device Owner", false, "refused"))
        runner.run("release")
        assertThat(device.releases).isEqualTo(1)
        // Paired again (to a new phone id); the old rules with release=true are still on disk.
        store.savePaired("phone-2", "pp_d_token2")
        api.failRules = IOException("no network")
        runner.run("offline after pairing again")
        assertThat(device.releases).isEqualTo(1)
        assertThat(device.applies).isNotEmpty()
        assertThat(store.releaseAsked).isFalse()
    }

    @Test
    fun `a phone removed during an unfinished release is locked again with its last rules`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(release = true))
        device.releaseResults = listOf(StepResult("give up Device Owner", false, "refused"))
        runner.run("release")
        assertThat(store.releaseAsked).isTrue()
        api.rules = RulesResult.Unpaired
        assertThat(runner.run("removed")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(store.releaseAsked).isFalse()
        assertThat(device.applies).isNotEmpty()
    }

    @Test
    fun `without release in the rules nothing is released, also from an older server`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        runner.run("a")
        api.rules = RulesResult.Changed("\"e2\"", rulesJson(release = false))
        runner.run("b")
        assertThat(device.releases).isEqualTo(0)
        assertThat(api.acks).isEmpty()
        assertThat(store.released).isFalse()
    }

    @Test
    fun `when the server cannot be told, the release is kept and the lock never comes back`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(release = true))
        api.ackFailure = IOException("no network")
        assertThat(runner.run("release")).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(store.released).isTrue()
        assertThat(store.removed).isFalse()

        // Still offline: only the acknowledgement is tried. No rules, no apps, no lock, no second release.
        val fetches = api.etagsSent.size
        val reported = api.appsReported.size
        assertThat(runner.run("still offline")).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(api.etagsSent).hasSize(fetches)
        assertThat(api.appsReported).hasSize(reported)
        assertThat(device.releases).isEqualTo(1)
        assertThat(device.applies).isEmpty()
        assertThat(api.acks).hasSize(2)

        api.ackFailure = null
        assertThat(runner.run("online again")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(api.acks).hasSize(3)
        assertThat(device.releases).isEqualTo(1)
        assertThat(device.applies).isEmpty()
        assertThat(store.removed).isTrue()
    }

    @Test
    fun `setup undo retries the report without reapplying protection`() {
        pair()
        assertThat(store.markSetupUndoPending(checkNotNull(store.phoneId))).isTrue()
        store.markReleased()
        var attempts = 0
        val reporting = object : SyncApi by api {
            override fun reportSetupUndo(token: String): Boolean {
                assertThat(token).isEqualTo("pp_d_token")
                if (++attempts <= 4) throw IOException("offline")
                return true
            }
        }
        var adminRemovals = 0
        val admin = object : SyncDevice by device {
            override fun removeSetupUndoAdmin() { adminRemovals++ }
        }
        repeat(4) {
            val reopened = SyncStore(context, FakeSecretBox())
            assertThat(SyncRunner(reopened, reporting, admin).run("undo setup"))
                .isInstanceOf(SyncRunner.Outcome.Failed::class.java)
            assertThat(reopened.setupUndoPending).isTrue()
            assertThat(reopened.removed).isFalse()
            assertThat(adminRemovals).isEqualTo(0)
        }
        assertThat(SyncRunner(store, reporting, admin).run("undo setup")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(SyncRunner(store, reporting, admin).run("undo setup")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(adminRemovals).isEqualTo(1)
        assertThat(attempts).isEqualTo(5)
        assertThat(device.releases).isEqualTo(0)
        assertThat(api.tokensUsed).isEmpty()
    }

    @Test
    fun `a rejected setup undo stays pending without acknowledging dashboard release`() {
        pair()
        assertThat(store.markSetupUndoPending(checkNotNull(store.phoneId))).isTrue()
        store.markReleased()
        api.ackResult = false
        val reporting = object : SyncApi by api {
            override fun reportSetupUndo(token: String): Boolean = false
        }

        assertThat(SyncRunner(store, reporting, device).run("rejected undo"))
            .isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(api.acks).isEmpty()
        assertThat(store.released).isTrue()
        assertThat(store.setupUndoPending).isTrue()
        assertThat(store.removed).isFalse()
        assertThat(device.applies).isEmpty()
    }

    @Test
    fun `a release that did not hold is not acknowledged and is tried again, also offline`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(release = true))
        device.releaseResults = listOf(StepResult("show hidden apps", true), StepResult("give up Device Owner", false, "some apps are still hidden"))
        val out = runner.run("release")
        assertThat(out).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(api.acks).isEmpty()
        assertThat(store.released).isFalse()
        assertThat(store.removed).isFalse()
        assertThat(device.applies).isEmpty()
        assertThat(api.statuses.single().failedPolicies).contains("remote release")

        // Unchanged rules still say release: it is tried again at the next sync.
        api.rules = RulesResult.Unchanged
        runner.run("again")
        assertThat(device.releases).isEqualTo(2)
        // Even without a network the stored rules finish the job locally.
        api.failRules = IOException("no network")
        runner.run("offline")
        assertThat(device.releases).isEqualTo(3)
        assertThat(device.applies).isEmpty()

        api.failRules = null
        device.releaseResults = listOf(StepResult("give up Device Owner", true))
        api.rules = RulesResult.Unchanged
        assertThat(runner.run("now it holds")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(api.acks).hasSize(1)
        assertThat(store.released).isTrue()
    }

    @Test
    fun `disabling release warnings skips the failure report without stopping release`() {
        pair()
        val rules = org.json.JSONObject(rulesJson(release = true)).put("releaseWarningsEnabled", false)
        api.rules = RulesResult.Changed("\"e1\"", rules.toString())
        device.releaseResults = listOf(StepResult("give up Device Owner", false))
        assertThat(runner.run("release")).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(device.releases).isEqualTo(1)
        assertThat(api.statuses).isEmpty()
        assertThat(api.acks).isEmpty()
    }

    @Test
    fun `a release that crashes counts as not held`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(release = true))
        val crashing = object : SyncDevice by device {
            override fun release(): List<StepResult> = throw IllegalStateException("boom")
        }
        assertThat(SyncRunner(store, api, crashing).run("release")).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(api.acks).isEmpty()
        assertThat(store.released).isFalse()
    }

    @Test
    fun `when the server says nobody asked, the phone goes on syncing with the real rules`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(release = true))
        api.ackResult = false
        assertThat(runner.run("release")).isInstanceOf(SyncRunner.Outcome.Failed::class.java)
        assertThat(store.released).isFalse()
        assertThat(store.removed).isFalse()

        api.rules = RulesResult.Changed("\"e2\"", rulesJson(release = false))
        assertThat(runner.run("next")).isEqualTo(SyncRunner.Outcome.Synced(changed = true, pollSeconds = 60))
        assertThat(device.releases).isEqualTo(1)
        assertThat(device.applies.last()).startsWith("new rules")
    }

    @Test
    fun `a new pairing clears the release, so the phone can be locked again`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(release = true))
        runner.run("release")
        assertThat(store.released).isTrue()
        store.savePaired("phone-2", "pp_d_token2")
        assertThat(store.released).isFalse()
        assertThat(store.removed).isFalse()
        assertThat(store.isPaired).isTrue()
    }
}
