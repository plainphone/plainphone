// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class ServerMoveTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val store = SyncStore(context, FakeSecretBox())
    private val oldServer = ConfigStore(context).load().serverUrl
    private val newServer = "https://destination.example.test:8443"
    private val newDns = "device.filter.example.test"
    private val oldToken = "pp_d_test"
    private val instruction = JSONObject().put("serverUrl", newServer).put("token", "pp_m_" + "x".repeat(43))

    @Test
    fun `an unavailable destination and filter leave protection in place until retry succeeds`() {
        val source = FakeSyncApi()
        val device = FakeSyncDevice()
        val oldRules = document()
        val oldId = oldRules.getString("phoneId")
        store.savePaired(oldId, oldToken)
        source.rules = RulesResult.Changed("old", oldRules.put("allowServerMove", true).put("move", instruction).toString())
        var destinationUp = false
        var dnsUp = false
        var receivedCredential: String? = null
        val newRules = document().put("phoneId", "7f1c2b9e-0000-4000-8000-000000000002")
        newRules.getJSONObject("dns").put("host", newDns)
        val remote = object : MoveApi {
            override fun redeemMove(token: String, deviceToken: String) {
                assertThat(token).isEqualTo(instruction.getString("token"))
                if (!destinationUp) throw IOException("server unavailable")
                receivedCredential?.let { assertThat(deviceToken).isEqualTo(it) }
                receivedCredential = deviceToken
            }

            override fun moveRules(deviceToken: String): RulesResult.Changed {
                // Same credential after a lost response, DNS outage or process restart.
                assertThat(deviceToken).isEqualTo(receivedCredential)
                return RulesResult.Changed("new", newRules.toString())
            }

        }
        val move = ServerMove(store, {
            assertThat(it).isEqualTo(newServer)
            remote
        }, {
            assertThat(it).isEqualTo(newDns)
            if (!dnsUp) throw IOException("filter unavailable")
        })
        var sourceStillOffersMove = true
        val sync = SyncRunner(store, source, device, oldServer) { token, target ->
            move.attempt(token, target, device.now) { sourceStillOffersMove }
        }

        fun assertOldProtection() {
            assertThat(store.deviceToken()).isEqualTo(oldToken)
            assertThat(store.phoneId).isEqualTo(oldId)
            assertThat(ConfigStore(context).load().serverUrl).isEqualTo(oldServer)
            assertThat(store.rules()!!.dnsHost).isEqualTo("abcdefghijklmnopqrst.dns.plainphone.org")
            assertThat(store.rules()!!.hiddenApps).containsExactly("com.example.game")
            assertThat(device.applies.last()).isNotEqualTo("server move")
        }

        sync.run("destination down")
        assertOldProtection()
        source.rules = RulesResult.Unchanged
        destinationUp = true
        sync.run("filter down")
        assertOldProtection()
        dnsUp = true
        newRules.getJSONObject("apps").getJSONArray("hidden").remove(0)
        sync.run("destination policy differs")
        assertOldProtection()
        newRules.getJSONObject("apps").getJSONArray("hidden").put("com.example.game")
        sourceStillOffersMove = false
        sync.run("source no longer offers move")
        assertOldProtection()
        sourceStillOffersMove = true
        sync.run("move")
        assertThat(store.deviceToken()).isEqualTo(receivedCredential)
        assertThat(store.phoneId).isEqualTo(newRules.getString("phoneId"))
        assertThat(ConfigStore(context).load().serverUrl).isEqualTo(newServer)
        assertThat(ConfigStore(context).load().dnsHost).isEqualTo(newDns)
        assertThat(store.rules()!!.hiddenApps).containsExactly("com.example.game")
        assertThat(device.applies.last()).isEqualTo("server move")
        // A previously constructed worker can never send the new credential to the old server.
        source.rules = RulesResult.Unpaired
        sync.run("stale worker")
        assertThat(store.isPaired).isTrue()
    }

    @Test
    fun `the phone ignores a move instruction when the dashboard switch is off`() {
        val source = FakeSyncApi()
        store.savePaired("original", oldToken)
        source.rules = RulesResult.Changed("old", document().put("allowServerMove", false).put("move", instruction).toString())
        var attempted = false
        SyncRunner(store, source, FakeSyncDevice(), oldServer) { _, _ ->
            attempted = true
            false
        }.run("disabled")
        assertThat(attempted).isFalse()
        assertThat(store.deviceToken()).isEqualTo(oldToken)
    }

    private fun document() = JSONObject(rulesJson(timeLimits = """{"total":null,"apps":[],"bonuses":[]}"""))
        .put("settings", JSONObject())
        .put("home", JSONObject())
        .put("suggestDeviceContacts", false)
        .put("lightContactRestriction", false)
        .put("selfScheduleContacts", JSONObject.NULL)
}
