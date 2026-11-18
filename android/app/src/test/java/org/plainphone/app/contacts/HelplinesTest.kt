// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.app.AppOpsManager
import android.app.Notification
import android.app.NotificationManager
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.webkit.WebResourceRequest
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.ui.test.junit4.v2.createEmptyComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performFirstLinkClick
import androidx.core.view.allViews
import android.os.Process
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.time.Instant
import java.time.ZoneOffset
import org.junit.Before
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith
import org.plainphone.app.R
import org.plainphone.app.home.HomeActivity as LauncherActivity
import org.plainphone.app.light.HomeActivity
import org.plainphone.app.ui.PhoneActivity
import org.plainphone.app.ui.MessageBody
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
import org.plainphone.app.telephony.CallNotifications
import org.plainphone.app.telephony.hasNumericGsmOrigin
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.shadows.ShadowUsageStatsManager.EventBuilder
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], qualifiers = "w393dp-h852dp-xxhdpi")
@GraphicsMode(GraphicsMode.Mode.NATIVE)
class HelplinesTest {
    @get:Rule
    val compose = createEmptyComposeRule()

    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Before
    fun configureCountry() {
        ConfigStore(context).save(PolicyConfig(countryCallingCode = "45"))
    }

    @Test
    fun `listed channels work outbound but inbound requires prior contact`() {
        val rules = ContactPolicySources.get(context).rules().copy(enforced = true, contacts = emptyList())
        val policy = ContactPolicy(EmergencyCheck { it == "112" })
        for (line in rules.help.lines) {
            for ((number, channel) in listOf(line.phone to Channel.CALL, line.sms to Channel.SMS)) {
                if (number == null) continue
                assertThat(policy.decide(rules, channel, Direction.OUTGOING, number).allowed).isTrue()
                assertThat(policy.decide(rules, channel, Direction.INCOMING, number).allowed).isFalse()
            }
        }
    }

    @Test
    fun `reply window is local per channel and expires`() {
        var now = 100_000L
        val replies = HelpReplies(context) { now }
        val rules = ContactPolicySources.get(context).rules()
            .copy(enforced = true, contacts = emptyList(), replyAgeMs = replies::ageMs)
        val policy = ContactPolicy(EmergencyCheck { false })
        val headspace = rules.helpContact("54 54 12 45", Channel.SMS)!!
        val other = "+4525800058"
        val callOnly = "+4570201201"
        fun allowed(channel: Channel, number: String) =
            policy.decide(rules, channel, Direction.INCOMING, number).allowed

        replies.record(Channel.CALL, headspace.number)
        assertThat(allowed(Channel.SMS, headspace.number)).isFalse()
        replies.record(Channel.SMS, headspace.number)
        assertThat(allowed(Channel.SMS, "54 54 12 45")).isTrue()
        assertThat(HelpReplies(context) { now }.ageMs(Channel.SMS, headspace.number)).isEqualTo(0L)
        assertThat(allowed(Channel.SMS, other)).isFalse()
        assertThat(policy.decide(rules, Channel.SMS, Direction.INCOMING, headspace.number, false).allowed).isFalse()
        replies.record(Channel.SMS, other)
        assertThat(allowed(Channel.SMS, "headspace")).isFalse()
        assertThat(allowed(Channel.SMS, "tel:54541245")).isFalse()
        assertThat(rules.incomingHelpContact("tel:54541245", Channel.SMS)).isNull()
        assertThat(policy.decide(rules, Channel.SMS, Direction.INCOMING, "tel:54541245").allowed).isFalse()

        replies.record(Channel.CALL, callOnly)
        assertThat(allowed(Channel.CALL, callOnly)).isFalse()
        val approved = rules.copy(contacts = listOf(ApprovedContact("Approved", callOnly)))
        assertThat(policy.decide(approved, Channel.CALL, Direction.INCOMING, callOnly).allowed).isTrue()
        now += 24 * 60 * 60_000L
        assertThat(allowed(Channel.SMS, headspace.number)).isFalse()
        assertThat(allowed(Channel.SMS, other)).isTrue()
        now += 96 * 60 * 60_000L
        assertThat(allowed(Channel.SMS, other)).isFalse()
    }

    @Test
    fun `reboot closes reply windows`() {
        val sender = "+4554541245"
        HelpReplies(context) { 1_000L }.record(Channel.SMS, sender)
        val currentBoot = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, 0)
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, currentBoot + 1)
        assertThat(HelpReplies(context) { 2_000L }.ageMs(Channel.SMS, sender)).isNull()
    }

    @Test
    fun `digit-only alphanumeric SMS addresses are not numeric sender IDs`() {
        assertThat(hasNumericGsmOrigin(byteArrayOf(0, 0, 8, 0x91.toByte()))).isTrue()
        assertThat(hasNumericGsmOrigin(byteArrayOf(0, 0, 8, 0xd0.toByte()))).isFalse()
    }

    @Test
    fun `help links only resolve listed numbers for the matching channel`() {
        val links = HelpLinks(context)
        assertThat(links.contactForLink(Uri.parse("tel:+4570201201"), Channel.CALL)?.number).isEqualTo("+4570201201")
        assertThat(links.contactForLink(Uri.parse("sms:54541245?body=hello"), Channel.SMS)?.number).isEqualTo("+4554541245")
        assertThat(links.contactForLink(Uri.parse("tel:54541245"), Channel.CALL)).isNull()
        assertThat(links.contactForLink(Uri.parse("sms:54541245,42424242"), Channel.SMS)).isNull()
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

    @Test fun phoneHelpDuringSchool() = checkHelpEntry(PhoneActivity::class.java, "school")
    @Test fun phoneHelpAtBedtime() = checkHelpEntry(PhoneActivity::class.java, "bedtime")
    @Test fun todayHelpDuringSchool() = checkHelpEntry(HomeActivity::class.java, "school")
    @Test fun todayHelpAtBedtime() = checkHelpEntry(HomeActivity::class.java, "bedtime")
    @Test fun launcherHelpDuringSchool() = checkHelpEntry(LauncherActivity::class.java, "school")
    @Test fun launcherHelpAtBedtime() = checkHelpEntry(LauncherActivity::class.java, "bedtime")

    private fun <T : android.app.Activity> checkHelpEntry(screen: Class<T>, kind: String) {
        val own = context.packageName
        val game = "com.game"
        val now = Instant.now()
        val zone = if (now.atOffset(ZoneOffset.UTC).hour in 6..17) "UTC" else "+12:00"
        val schedule = """[{"id":"test","kind":"$kind","days":[1,2,3,4,5,6,7],"start":"06:00","end":"19:00","allowedPackages":[]}]"""
        val body = rulesJson(allowed = listOf(game), schedules = schedule, timezone = zone)
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
        Robolectric.buildActivity(screen).setup().use { controller ->
            compose.onNodeWithText(context.getString(R.string.help_lines_title)).performClick()
            val launched = shadowOf(controller.get()).nextStartedActivity
            assertThat(launched.component?.className).isEqualTo(HelpActivity::class.java.name)
            Robolectric.buildActivity(HelpActivity::class.java, launched).setup().use { help ->
                assertThat(help.get().isFinishing).isFalse()
            }
        }
    }

    @Test
    fun `catalogue links match the Android help link filter`() {
        val directory = ContactPolicySources.get(context).rules().help
        fun matches(url: String): Boolean {
            val link = Intent(Intent.ACTION_VIEW, Uri.parse(url)).addCategory(Intent.CATEGORY_BROWSABLE)
            return context.packageManager.queryIntentActivities(link, android.content.pm.PackageManager.MATCH_DEFAULT_ONLY)
                .any { it.activityInfo.name == HelpActivity::class.java.name }
        }
        for (domain in directory.domains) {
            assertThat(matches("https://$domain/help")).isTrue()
            assertThat(matches("http://www.$domain/help")).isTrue()
        }
        for (host in directory.exactHosts) {
            assertThat(matches("https://$host/help")).isTrue()
            assertThat(matches("https://www.$host/help")).isFalse()
        }
        assertThat(matches("https://bornetelefonen.dk.example.org/help")).isFalse()
        assertThat(matches("https://example.org/help")).isFalse()
    }

    @Test
    fun `tapping a help link in a message opens it over HTTPS inside Help`() {
        val body = "Talk to someone: http://bornetelefonen.dk/kontakt-os/"
        Robolectric.buildActivity(ComponentActivity::class.java).setup().use { message ->
            message.get().setContent { MessageBody(body) }
            compose.onNodeWithText(body).performFirstLinkClick()
            val launched = shadowOf(message.get()).nextStartedActivity
            assertThat(launched.component?.className).isEqualTo(HelpActivity::class.java.name)
            val expected = "https://bornetelefonen.dk/kontakt-os/"
            assertThat(launched.dataString).isEqualTo(expected)
            Robolectric.buildActivity(HelpActivity::class.java, launched).setup().use { help ->
                compose.waitForIdle()
                val web = help.get().window.decorView.allViews.filterIsInstance<WebView>().single()
                assertThat(shadowOf(web).lastLoadedUrl).isEqualTo(expected)
            }
        }
    }

    @Test
    fun `help SMS notifications are secret on the lock screen`() {
        CallNotifications.showMessage(context, "Help", "116111", "Private reply", privateOnLockScreen = true)
        val manager = context.getSystemService(NotificationManager::class.java)
        assertThat(manager.activeNotifications.single().notification.visibility).isEqualTo(Notification.VISIBILITY_SECRET)
    }

    @Test
    fun `ordinary notification opens the approved contact heading even for a catalogue number`() {
        val number = "+4554541245"
        LocalContactPolicySource(context).add(ApprovedContact("Approved contact", number)).getOrThrow()
        CallNotifications.showMessage(context, "Approved contact", number, "Ordinary SMS", privateOnLockScreen = true)
        val manager = context.getSystemService(NotificationManager::class.java)
        val open = shadowOf(manager.activeNotifications.single().notification.contentIntent).savedIntent
        Robolectric.buildActivity(PhoneActivity::class.java, open).setup().use {
            // The activity loads contact rules on Dispatchers.IO, outside Compose's idling scope.
            compose.waitUntil(timeoutMillis = 5_000) {
                compose.onAllNodesWithText("Approved contact").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Approved contact").assertExists()
            compose.onNodeWithText("headspace").assertDoesNotExist()
        }
    }

    @Test
    fun `reopening Help waits for the previous session cookie removal`() {
        val callbacks = ArrayDeque<() -> Unit>()
        val sessions = HelpSessions { complete -> callbacks.addLast(complete) }
        val loads = mutableListOf<String>()

        val close = sessions.open { loads += "first" }
        callbacks.removeFirst()()
        assertThat(loads).containsExactly("first")
        close()
        sessions.clear()

        val cancel = sessions.open { loads += "closed before loading" }
        cancel()
        sessions.clear()
        sessions.open { loads += "reopened" }

        repeat(3) {
            callbacks.removeFirst()()
            assertThat(loads).containsExactly("first")
        }
        callbacks.removeFirst()()
        assertThat(loads).containsExactly("first", "reopened").inOrder()
    }

    @Test
    fun `initial iframe requests are restricted to catalogue hosts`() {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse("https://headspace.dk/chatten/"), context, HelpActivity::class.java)
        Robolectric.buildActivity(HelpActivity::class.java, intent).setup().use { help ->
            compose.waitForIdle()
            val web = help.get().window.decorView.allViews.filterIsInstance<WebView>().single()

            fun frame(url: String, method: String = "GET") = object : WebResourceRequest {
                override fun getUrl() = Uri.parse(url)
                override fun isForMainFrame() = false
                override fun isRedirect() = false
                override fun hasGesture() = false
                override fun getMethod() = method
                override fun getRequestHeaders() = emptyMap<String, String>()
            }

            val external = frame("https://example.org/")
            val chat = frame("https://phs.basechat.com/chat")
            assertThat(web.webViewClient.shouldInterceptRequest(web, external)?.statusCode).isEqualTo(403)
            assertThat(web.webViewClient.shouldOverrideUrlLoading(web, external)).isTrue()
            assertThat(web.webViewClient.shouldInterceptRequest(web, chat)).isNull()
            assertThat(web.webViewClient.shouldOverrideUrlLoading(web, chat)).isFalse()
            assertThat(web.webViewClient.shouldInterceptRequest(web, frame(chat.url.toString(), "POST"))?.statusCode)
                .isEqualTo(403)
        }
    }

    @Test
    fun `help accepts chat hosts and rejects other destinations`() {
        val links = HelpLinks(context)
        assertThat(links.allowsNavigation(Uri.parse("https://phs.basechat.com/chat"))).isTrue()
        for (url in listOf(
            "https://example.org/",
            "https://www.c.basechat.com/",
            "https://www.phs.basechat.com/",
            "https://bornetelefonen.dk.example.org/",
            "https://example.org@bornetelefonen.dk/",
            "https://bornetelefonen.dk:8443/",
            "file:///data/help",
        )) {
            assertThat(links.allowsNavigation(Uri.parse(url))).isFalse()
            val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url), context, HelpActivity::class.java)
            Robolectric.buildActivity(HelpActivity::class.java, intent).create().use { help ->
                assertThat(help.get().isFinishing).isTrue()
            }
        }
    }
}
