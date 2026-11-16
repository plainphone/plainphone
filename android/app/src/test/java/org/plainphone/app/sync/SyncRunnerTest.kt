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

    private fun pair() = store.savePaired("phone-1", "pp_d_token")

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
    fun `apps are reported once, and again when they change`() {
        pair()
        runner.run("1")
        runner.run("2")
        assertThat(api.appsReported).hasSize(1)
        device.apps = device.apps + InstalledApp("com.example.new", "New", core = false)
        runner.run("3")
        assertThat(api.appsReported).hasSize(2)
        assertThat(api.appsReported.last().map { it.packageName }).contains("com.example.new")
    }

    @Test
    fun `Find is answered once with a precise position`() {
        pair()
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
    fun `no position is sent when the parent turned location off`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson(locationEnabled = false, requestedAt = "2027-01-04T10:00:00.000Z"))
        runner.run("off")
        assertThat(device.locationRequests).isEmpty()
        assertThat(api.locations).isEmpty()
    }

    @Test
    fun `status goes out at once when the lock changes, otherwise every 15 minutes`() {
        pair()
        api.rules = RulesResult.Changed("\"e1\"", rulesJson())
        runner.run("1")
        assertThat(api.statuses).hasSize(1)
        assertThat(api.statuses[0].lockIntact).isTrue()
        assertThat(api.statuses[0].rulesEtag).isEqualTo("\"e1\"")
        assertThat(api.statuses[0].batteryPct).isEqualTo(64)

        api.rules = RulesResult.Unchanged
        device.now += 60_000
        runner.run("2")
        assertThat(api.statuses).hasSize(1)

        device.lock = device.lock.copy(failedPolicies = listOf("private DNS"))
        runner.run("3")
        assertThat(api.statuses).hasSize(2)
        assertThat(api.statuses[1].lockIntact).isFalse()
        assertThat(api.statuses[1].failedPolicies).containsExactly("private DNS")

        device.now += SyncRunner.STATUS_EVERY_MS
        runner.run("4")
        assertThat(api.statuses).hasSize(3)
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
}
