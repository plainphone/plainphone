// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.json.JSONObject
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.junit.Assert.assertEquals
import org.plainphone.app.light.ActiveOpening
import org.plainphone.app.light.EmergencyJson
import org.plainphone.app.light.EmergencyOpening
import org.plainphone.app.light.EmergencyState
import org.plainphone.app.light.EmergencyRules
import org.robolectric.RobolectricTestRunner

/** `selfEmergency` in the rules document, and the report of openings in the sync loop. */
@RunWith(RobolectricTestRunner::class)
class EmergencyRulesTest {
    private val context = ApplicationProvider.getApplicationContext<android.app.Application>()
    private lateinit var store: SyncStore
    private lateinit var api: FakeSyncApi
    private lateinit var runner: SyncRunner

    @Before
    fun setUp() {
        context.getSharedPreferences("plainphone_emergency_openings", 0).edit().clear().commit()
        store = SyncStore(context, FakeSecretBox())
        api = FakeSyncApi()
        runner = SyncRunner(store, api, FakeSyncDevice())
        store.savePaired("7f1c2b9e-0000-4000-8000-000000000001", "pp_d_token")
    }

    private fun parse(selfEmergency: String?): ServerRules {
        val doc = JSONObject(rulesJson()).put("profile", "self")
        if (selfEmergency != null) doc.put("selfEmergency", JSONObject(selfEmergency))
        return ServerRules.parse(doc.toString())
    }

    // --- parsing -------------------------------------------------------------------------

    @Test fun `present`() {
        val e = parse("""{"enabled":true,"allowance":4,"minutes":15,"used":{"month":"2026-06","count":2}}""").selfEmergency
        assertThat(e.enabled).isTrue()
        assertThat(e.allowance).isEqualTo(4)
        assertThat(e.minutes).isEqualTo(15)
        assertThat(e.usedMonth).isEqualTo("2026-06")
        assertThat(e.usedCount).isEqualTo(2)
    }

    @Test fun `absent from an older server means off`() {
        assertThat(parse(null).selfEmergency).isEqualTo(EmergencyRules.OFF)
        assertThat(parse(null).selfEmergency.enabled).isFalse()
    }

    @Test fun `disabled means off, whatever else it says`() {
        assertThat(parse("""{"enabled":false,"allowance":5,"minutes":15,"used":{"month":"2026-06","count":0}}""").selfEmergency.enabled).isFalse()
    }

    @Test fun `malformed never breaks the other rules`() {
        for (bad in listOf(
            """{"enabled":"yes","allowance":"many"}""",
            """{"enabled":true,"allowance":"many","minutes":{}}""",
            """{"enabled":true,"allowance":3,"used":"lots"}""",
            """{"enabled":true,"allowance":3,"used":{"month":"June","count":"x"}}""",
            "{}",
        )) {
            val rules = parse(bad)
            assertThat(rules.phoneId).isEqualTo("7f1c2b9e-0000-4000-8000-000000000001")
            // Either off, or on with safe values; never an exception and never a month that does not exist.
            assertThat(rules.selfEmergency.usedMonth).isNull()
            assertThat(rules.selfEmergency.usedCount).isEqualTo(0)
            assertThat(rules.selfEmergency.allowance).isAtMost(10)
        }
        assertThat(parse("""{"enabled":true,"allowance":"many"}""").selfEmergency.allowance).isEqualTo(0)
    }

    @Test fun `out of range values are held inside the contract`() {
        val e = parse("""{"enabled":true,"allowance":99,"minutes":240,"used":{"month":"2026-06","count":-5}}""").selfEmergency
        assertThat(e.allowance).isEqualTo(10)
        assertThat(e.minutes).isEqualTo(15)
        assertThat(e.usedCount).isEqualTo(0)
    }

    @Test fun `a document with the field is stored and read back from the phone`() {
        api.rules = RulesResult.Changed("\"e1\"", JSONObject(rulesJson()).put("profile", "self")
            .put("selfEmergency", JSONObject("""{"enabled":true,"allowance":2,"minutes":15,"used":{"month":"2026-06","count":1}}""")).toString())
        runner.run("test")
        assertThat(store.rules()!!.selfEmergency.allowance).isEqualTo(2)
    }

    // --- the sync loop ---------------------------------------------------------------------

    private fun queue(): EmergencyOpening {
        // The real path, with the phone's own clocks: recorded locally first.
        val started = store.emergencyOpenings.start(
            "com.example.game", org.plainphone.app.light.BlockedActivity.Reason.NOT_ALLOWED, true,
            EmergencyRules(true, 3, 15, null, 0), java.time.ZoneId.of("Europe/Copenhagen"), context.packageName,
        )
        return (started as org.plainphone.app.light.EmergencyStart.Started).opening
    }

    @Test fun `a queued opening goes out at the next sync, once, even with the feature switched off`() {
        api.rules = RulesResult.Changed("\"e\"", rulesJson())
        val opening = queue()
        runner.run("test")
        assertThat(api.emergencyReports.map { it.id }).containsExactly(opening.id)
        runner.run("again")
        assertThat(api.emergencyReports).hasSize(1)
        assertThat(store.emergencyOpenings.pending()).isEmpty()
    }

    @Test fun `offline the opening stays queued, the sync goes on, and it is sent with the same id later`() {
        api.rules = RulesResult.Changed("\"e\"", rulesJson())
        val opening = queue()
        api.emergencyFailure = IOException("offline")
        val out = runner.run("offline")
        assertThat(out).isInstanceOf(SyncRunner.Outcome.Synced::class.java)
        assertThat(api.statuses).isNotEmpty() // the rest of the sync still ran
        assertThat(store.emergencyOpenings.pending().map { it.id }).containsExactly(opening.id)
        api.emergencyFailure = null
        runner.run("online")
        assertThat(api.emergencyReports.map { it.id }).containsExactly(opening.id)
        assertThat(store.emergencyOpenings.pending()).isEmpty()
    }

    @Test fun `the saved state survives a round trip as JSON`() {
        val state = EmergencyState(
            listOf(EmergencyOpening("a", "com.example.game", 123L, 15, false), EmergencyOpening("b", "com.example.video", 456L, 15, true)),
            ActiveOpening("com.example.game", 123L, 9L, 7, 15),
        )
        assertEquals(state, EmergencyJson.read(EmergencyJson.write(state)))
        assertEquals(EmergencyState(), EmergencyJson.read("not json"))
        assertEquals(EmergencyState(), EmergencyJson.read(null))
    }
}
