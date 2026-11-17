// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.LocalDate
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.plainphone.app.FakeDevice
import org.plainphone.app.MemoryHiddenStore
import org.plainphone.app.PolicyApplier
import org.plainphone.app.PolicyConfig
import org.plainphone.app.light.LightPlan
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.FakeSyncApi
import org.plainphone.app.sync.FakeSyncDevice
import org.plainphone.app.sync.SyncDevice
import org.plainphone.app.sync.SyncRunner
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.TimeLimits
import org.plainphone.app.time.TimeGuard
import org.robolectric.RobolectricTestRunner

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
        assertThat(rules.help.lines.map { it.name }).containsAtLeast("BørneTelefonen", "Livslinien", "headspace", "BackOp (Cyberhus)", "Sexlinien")
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
    fun `opening help does not use reported minutes even with a zero total cap`() {
        val own = context.packageName
        val limits = TimeLimits(TimeLimits.Limit(0), emptyMap(), emptyList())
        val usage = limits.evaluate(mapOf(own to 120_000L, "com.game" to 60_000L), LocalDate.of(2026, 11, 17), TimeGuard.exempt(context))
        assertThat(usage.totalUsedUp).isTrue()
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("phone-1", "pp_d_token")
        val api = FakeSyncApi()
        val device = object : SyncDevice by FakeSyncDevice() {
            override fun timeUsed(): Map<String, Int> = usage.usedMinutes(emptySet())
        }
        TelephonyLog(context).recordBlocked(Channel.CALL, Direction.OUTGOING, "116111")
        SyncRunner(store, api, device).run("test")
        val payload = api.statuses.single().toJson()
        assertThat(payload.getJSONObject("timeUsed").toString()).isEqualTo("""{"*":1}""")
        assertThat(payload.toString()).doesNotContain("116111")

        val strong = FakeDevice(launchable = mutableSetOf(own, "com.game"), core = emptySet())
        PolicyApplier(strong, MemoryHiddenStore(), sdkInt = 35).apply(
            PolicyConfig(dnsHost = "dns.example.org", timeBlocked = setOf(own, "com.game")),
        )
        assertThat(strong.hidden).doesNotContain(own)
        assertThat(strong.suspended).doesNotContain(own)
        val plan = LightPlan.build(
            launchable = setOf(own, "com.game"), core = emptySet(), allowed = emptySet(),
            ownPackage = own, telephony = emptySet(), timeBlocked = setOf("com.game"), installing = null,
        )
        assertThat(plan.blocked).doesNotContain(own)
        assertThat(plan.timeBlocked).doesNotContain(own)
    }
}
