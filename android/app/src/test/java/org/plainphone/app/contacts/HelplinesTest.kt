// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.app.AppOpsManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.os.Process
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.ZoneOffset
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.plainphone.app.FakeDevice
import org.plainphone.app.MemoryHiddenStore
import org.plainphone.app.PolicyApplier
import org.plainphone.app.PolicyConfig
import org.plainphone.app.light.LightPlan
import org.plainphone.app.sync.AndroidSyncDevice
import org.plainphone.app.sync.EffectivePolicy
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.FakeSyncApi
import org.plainphone.app.sync.FakeSyncDevice
import org.plainphone.app.sync.SyncDevice
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.rulesJson
import org.plainphone.app.time.TimeGuard
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowUsageStatsManager.EventBuilder

@RunWith(RobolectricTestRunner::class)
class HelplinesTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Before
    fun configureCountry() {
        ConfigStore(context).save(PolicyConfig(countryCallingCode = "45"))
    }

    @Test
    fun `every listed contact channel works in both directions with no approved contacts`() {
        val rules = ContactPolicySources.get(context).rules()
        assertThat(rules.help.lines.map { it.name }).containsAtLeast("BørneTelefonen", "Livslinien", "headspace", "Sexlinien")
        val policy = ContactPolicy(EmergencyCheck { it == "112" })
        for (enforced in listOf(true, false)) {
            val empty = rules.copy(enforced = enforced, contacts = emptyList())
            for (line in empty.help.lines) {
                for ((number, channel) in listOf(line.phone to Channel.CALL, line.sms to Channel.SMS)) {
                    if (number == null) continue
                    for (direction in Direction.entries) {
                        if (number == "112" && direction == Direction.INCOMING) continue
                        assertThat(policy.decide(empty, channel, direction, number).allowed).isTrue()
                    }
                }
            }
        }
        assertThat(policy.decide(rules.copy(enforced = true), Channel.CALL, Direction.OUTGOING, "70 20 12 01").allowed).isTrue()
    }

    @Test
    fun `headspace youth SMS is allowed and private in both directions`() {
        val rules = ContactPolicySources.get(context).rules().copy(enforced = true, contacts = emptyList())
        val policy = ContactPolicy(EmergencyCheck { false })
        val log = TelephonyLog(context)
        for (direction in Direction.entries) {
            val number = if (direction == Direction.OUTGOING) "54 54 12 45" else "+4554541245"
            assertThat(policy.decide(rules, Channel.SMS, direction, number).allowed).isTrue()
            log.recordBlocked(Channel.SMS, direction, number)
        }
        assertThat(log.blocked()).isEmpty()
    }

    @Test
    fun `help contact attempts are not retained in the parent blockage log`() {
        val log = TelephonyLog(context)
        log.recordBlocked(Channel.SMS, Direction.INCOMING, "116 111")
        log.recordBlocked(Channel.CALL, Direction.OUTGOING, "0045 70 20 12 01")
        log.recordBlocked(Channel.CALL, Direction.INCOMING, "42 42 42 42")
        assertThat(log.blocked().map { it.number }).containsExactly("42 42 42 42")
        val stored = context.getSharedPreferences("plainphone_telephony", Context.MODE_PRIVATE).getString("blocked", "")
        assertThat(stored).doesNotContain("116 111")
        assertThat(stored).doesNotContain("70 20 12 01")
    }

    @Test
    fun `help usage stays out of the actual Android status payload with a zero cap`() {
        val own = context.packageName
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("phone-1", "pp_d_token")
        val now = Instant.now()
        val zone = if (now.atOffset(ZoneOffset.UTC).hour == 0) "+12:00" else "UTC"
        store.saveRules(
            "test",
            rulesJson(timezone = zone, timeLimits = """{"total":{"minutes":0}}"""),
            now.toEpochMilli(),
        )
        shadowOf(context.getSystemService(AppOpsManager::class.java)).setMode(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), own, AppOpsManager.MODE_ALLOWED,
        )
        val stats = shadowOf(context.getSystemService(UsageStatsManager::class.java))
        val start = now.toEpochMilli() - 240_000L
        fun foreground(pkg: String, activity: String, from: Long, until: Long) {
            for ((at, type) in listOf(from to UsageEvents.Event.ACTIVITY_RESUMED, until to UsageEvents.Event.ACTIVITY_PAUSED)) {
                stats.addEvent(EventBuilder.buildEvent().setPackage(pkg).setClass(activity).setTimeStamp(at).setEventType(type).build())
            }
        }
        foreground(own, HelpActivity::class.java.name, start, start + 120_000L)
        foreground("com.game", "Game", start + 125_000L, start + 185_000L)

        assertThat(TimeGuard.snapshot(context)?.evaluation?.totalUsedUp).isTrue()
        val api = FakeSyncApi()
        val android = AndroidSyncDevice(context)
        val device = object : SyncDevice by FakeSyncDevice() {
            override fun timeUsed() = android.timeUsed()
        }
        TelephonyLog(context).recordBlocked(Channel.CALL, Direction.OUTGOING, "116111")
        SyncRunner(store, api, device).run("test")
        val payload = api.statuses.single().toJson()
        assertThat(payload.getJSONObject("timeUsed").toString()).isEqualTo("""{"*":1}""")
        assertThat(payload.toString()).doesNotContain("116111")
    }

    @Test
    fun `help screen opens during active school and bedtime windows in both modes`() {
        val own = context.packageName
        val game = "com.game"
        val now = Instant.parse("2026-11-17T12:00:00Z")
        for (kind in listOf("school", "bedtime")) {
            val schedule = """[{"id":"test","kind":"$kind","days":[2],"start":"11:00","end":"14:00","allowedPackages":[]}]"""
            val body = rulesJson(allowed = listOf(game), schedules = schedule, timezone = "UTC")
            val rules = ServerRules.parse(body)
            val config = EffectivePolicy.merge(PolicyConfig(), rules, now, timeBlocked = setOf(own, game))
            assertThat(config.server?.windowActive).isTrue()
            val strong = FakeDevice(launchable = mutableSetOf(own, game), core = emptySet())
            PolicyApplier(strong, MemoryHiddenStore(), sdkInt = 35).apply(config)
            assertThat(strong.hidden).contains(game)
            assertThat(strong.hidden).doesNotContain(own)
            assertThat(strong.suspended).doesNotContain(own)
            val light = LightPlan.build(
                launchable = setOf(own, game), core = emptySet(), allowed = config.allowedPackages,
                ownPackage = own, telephony = emptySet(), timeBlocked = config.timeBlocked, installing = null,
            )
            assertThat(light.why(game)).isEqualTo(LightPlan.Why.NOT_ALLOWED)
            assertThat(light.why(own)).isNull()

            SyncStore(context, FakeSecretBox()).saveRules("test", body, now.toEpochMilli())
            Robolectric.buildActivity(HelpActivity::class.java).setup().use { controller ->
                assertThat(controller.get().isFinishing).isFalse()
            }
        }
    }
}
