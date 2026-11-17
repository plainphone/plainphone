// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import org.json.JSONObject
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PolicyConfig
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class) // org.json is Android's
class TimeLimitsTest {
    private val monday = LocalDate.of(2026, 11, 16)
    private val saturday = LocalDate.of(2026, 11, 21)
    private val limitsJson = """
        {"total":{"minutes":120,"days":{"6":180,"7":180}},
         "apps":[{"packageName":"com.spotify.music","minutes":60,"days":{}},{"packageName":"com.game","minutes":0}],
         "bonuses":[{"packageName":"*","date":"2026-11-16","minutes":15},{"packageName":"com.spotify.music","date":"2026-11-17","minutes":30}]}
    """.trimIndent()
    private val limits = TimeLimits.parse(JSONObject(limitsJson))
    private val min = 60_000L

    @Test
    fun `weekday overrides and bonuses decide the cap`() {
        assertThat(limits.capMinutes(TimeLimits.TOTAL, monday)).isEqualTo(135) // 120 + 15 bonus
        assertThat(limits.capMinutes(TimeLimits.TOTAL, saturday)).isEqualTo(180)
        assertThat(limits.capMinutes("com.spotify.music", monday)).isEqualTo(60)
        assertThat(limits.capMinutes("com.spotify.music", monday.plusDays(1))).isEqualTo(90)
        assertThat(limits.capMinutes("com.other", monday)).isNull()
    }

    @Test
    fun `an app is used up by its own cap or by the total`() {
        val core = setOf("com.android.dialer")
        val e = limits.evaluate(mapOf("com.spotify.music" to 60 * min, "com.other" to 10 * min), monday, core)
        assertThat(e.isUsedUp("com.spotify.music")).isTrue()
        assertThat(e.isUsedUp("com.other")).isFalse()
        assertThat(e.isUsedUp("com.game")).isTrue() // 0 minutes means never today
        assertThat(e.totalRemainingMs).isEqualTo((135 - 70) * min)
        assertThat(e.remainingFor("com.other")).isEqualTo((135 - 70) * min)
        assertThat(e.usedUpApps).containsExactly("com.spotify.music", "com.game")
    }

    @Test
    fun `core apps never count towards the total`() {
        val core = setOf("com.android.dialer", "com.google.android.apps.maps")
        val e = limits.evaluate(mapOf("com.android.dialer" to 500 * min, "com.google.android.apps.maps" to 300 * min, "com.x" to 20 * min), monday, core)
        assertThat(e.totalUsedMs).isEqualTo(20 * min)
        assertThat(e.totalUsedUp).isFalse()
    }

    @Test
    fun `the total used up blocks everything that is not core`() {
        val e = limits.evaluate(mapOf("com.x" to 135 * min), monday, emptySet())
        assertThat(e.totalUsedUp).isTrue()
        assertThat(e.isUsedUp("com.y")).isTrue()
    }

    @Test
    fun `used minutes for the dashboard`() {
        val e = limits.evaluate(mapOf("com.spotify.music" to 12 * min + 30_000, "com.x" to 22 * min), monday, emptySet())
        assertThat(e.usedMinutes(setOf("com.spotify.music"))).containsExactly("*", 34, "com.spotify.music", 12)
    }

    @Test
    fun `malformed limits throw`() {
        assertThrows(Exception::class.java) { TimeLimits.parse(JSONObject("""{"total":{"minutes":2000}}""")) }
        assertThrows(Exception::class.java) { TimeLimits.parse(JSONObject("""{"total":{"minutes":10,"days":{"8":5}}}""")) }
    }

    @Test
    fun `rules without time limits or toInstall still parse (older servers)`() {
        val r = ServerRules.parse(rulesJson())
        assertThat(r.timeLimits).isEqualTo(TimeLimits.NONE)
        assertThat(r.toInstall).isEmpty()
    }

    @Test
    fun `rules carry time limits and catalog installs`() {
        val r = ServerRules.parse(rulesJson(toInstall = """[{"packageName":"dk.mitid.app.android","label":"MitID"}]""", timeLimits = limitsJson))
        assertThat(r.toInstall).containsExactly(CatalogInstall("dk.mitid.app.android", "MitID"))
        assertThat(r.timeLimits.apps.keys).containsExactly("com.spotify.music", "com.game")
    }

    @Test
    fun `catalog apps waiting to be installed count as allowed, and only they open the install window`() {
        val r = ServerRules.parse(rulesJson(toInstall = """[{"packageName":"dk.mitid.app.android","label":"MitID"}]"""))
        val now = Instant.parse("2026-11-17T10:00:00Z")
        val merged = EffectivePolicy.merge(PolicyConfig(), r, now, installing = "dk.mitid.app.android")
        assertThat(merged.allowedPackages).contains("dk.mitid.app.android")
        assertThat(merged.installing).isEqualTo("dk.mitid.app.android")
        assertThat(merged.installAccountsAllowed).isFalse()
        val parentAuthorized = EffectivePolicy.merge(
            PolicyConfig(), r, now, installing = "dk.mitid.app.android", installAccountsAllowed = true,
        )
        assertThat(parentAuthorized.installAccountsAllowed).isTrue()
        assertThat(EffectivePolicy.fingerprint(parentAuthorized)).isNotEqualTo(EffectivePolicy.fingerprint(merged))
        val unapproved = EffectivePolicy.merge(
            PolicyConfig(), r, now, installing = "com.tiktok", installAccountsAllowed = true,
        )
        assertThat(unapproved.installing).isNull()
        assertThat(unapproved.installAccountsAllowed).isFalse()
    }

    @Test
    fun `a change in used-up apps changes the fingerprint`() {
        val r = ServerRules.parse(rulesJson())
        val now = Instant.parse("2026-11-17T10:00:00Z")
        val a = EffectivePolicy.fingerprint(EffectivePolicy.merge(PolicyConfig(), r, now))
        val b = EffectivePolicy.fingerprint(EffectivePolicy.merge(PolicyConfig(), r, now, timeBlocked = setOf("com.spotify.music")))
        assertThat(a).isNotEqualTo(b)
    }
}

class UsageCounterTest {
    private val zone = ZoneId.of("Europe/Copenhagen")
    private val day = UsageCounter.dayStartMs(Instant.parse("2026-11-17T10:00:00Z"), zone)
    private val min = 60_000L
    private fun ev(pkg: String, kind: UsageCounter.Kind, minute: Long) = UsageCounter.Event(pkg, kind, day + minute * min)

    @Test
    fun `day starts at local midnight`() {
        assertThat(Instant.ofEpochMilli(day)).isEqualTo(Instant.parse("2026-11-16T23:00:00Z"))
    }

    @Test
    fun `foreground time is summed per app and clipped to today`() {
        val events = listOf(
            ev("a", UsageCounter.Kind.RESUMED, -30), // open across midnight: counts from midnight
            ev("a", UsageCounter.Kind.PAUSED, 10),
            ev("b", UsageCounter.Kind.RESUMED, 20),
            ev("a", UsageCounter.Kind.RESUMED, 25), // switching apps closes b
            ev("a", UsageCounter.Kind.SCREEN_OFF, 40),
            ev("b", UsageCounter.Kind.RESUMED, 50), // still open now
        )
        val used = UsageCounter.foregroundMs(events, day, day + 60 * min)
        assertThat(used).containsExactly("a", 25 * min, "b", 15 * min)
    }

    @Test
    fun `a pause of another app does not end the one in front`() {
        val events = listOf(ev("a", UsageCounter.Kind.RESUMED, 0), ev("b", UsageCounter.Kind.PAUSED, 5))
        assertThat(UsageCounter.foregroundMs(events, day, day + 10 * min)).containsExactly("a", 10 * min)
    }
}
