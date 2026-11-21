// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.billing

import android.app.Application
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.time.Instant
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.EarlyUnlockOffer
import org.plainphone.app.sync.EarlyUnlockPurchase
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Offer -> what the phone shows, the consent gate, and the device billing calls. Robolectric for org.json. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class EarlyUnlockLogicTest {
    private val now = Instant.parse("2027-01-04T12:00:00Z")
    private val change = "11111111-0000-4000-8000-000000000001"
    private val buddyChange = "11111111-0000-4000-8000-000000000002"

    private fun rules(profile: String = "self", earlyUnlock: JSONObject? = EARLY_UNLOCK, keyType: String = "delay"): ServerRules {
        val j = JSONObject(rulesJson()).put("profile", profile)
        earlyUnlock?.let { j.put("earlyUnlock", it) }
        j.put("pendingChanges", JSONArray()
            .put(JSONObject().put("id", change).put("op", JSONObject().put("type", "apps.allow")).put("keyType", keyType).put("effectiveAt", "2027-01-05T12:00:00Z"))
            .put(JSONObject().put("id", buddyChange).put("op", JSONObject()).put("keyType", "trusted").put("effectiveAt", JSONObject.NULL)))
        return ServerRules.parse(j.toString())
    }

    private fun offer(
        available: Boolean = true,
        reason: String? = null,
        effectiveAt: Instant? = Instant.parse("2027-01-05T12:00:00Z"),
        nextAvailableAt: Instant? = null,
        purchase: EarlyUnlockPurchase? = null,
        changeId: String = change,
    ) = EarlyUnlockOffer(changeId, effectiveAt, available, reason, 1000, "DKK", 10, nextAvailableAt, purchase)

    private fun purchase(status: String, canWithdraw: Boolean = status == "scheduled") =
        EarlyUnlockPurchase("22222222-0000-4000-8000-000000000009", status, 1000, "DKK", Instant.parse("2027-01-04T12:10:00Z"), canWithdraw)

    @Test
    fun `only a Myself phone with the early unlock block and a wait-time change shows anything`() {
        assertThat(EarlyUnlockLogic.relevant(rules())).isTrue()
        assertThat(rules().earlyUnlock?.price).isEqualTo(1000)
        assertThat(EarlyUnlockLogic.relevant(rules(earlyUnlock = null))).isFalse()
        assertThat(EarlyUnlockLogic.relevant(rules(profile = "child"))).isFalse()
        assertThat(EarlyUnlockLogic.relevant(rules(keyType = "trusted"))).isFalse()
        assertThat(EarlyUnlockLogic.relevant(null)).isFalse()
        // Older servers send neither field.
        assertThat(ServerRules.parse(rulesJson()).earlyUnlock).isNull()
    }

    @Test
    fun `a malformed early unlock block hides the offer instead of breaking the rules`() {
        assertThat(rules(earlyUnlock = JSONObject().put("enabled", true).put("price", 0).put("currency", "DKK")).earlyUnlock).isNull()
        assertThat(rules(earlyUnlock = JSONObject().put("enabled", false).put("price", 1000).put("currency", "DKK")).earlyUnlock).isNull()
        assertThat(rules(earlyUnlock = JSONObject().put("enabled", true).put("price", 1000)).earlyUnlock).isNull()
    }

    @Test
    fun `an available offer shows both choices`() {
        assertThat(EarlyUnlockLogic.show(offer(), now, emptySet()))
            .isEqualTo(EarlyUnlockShow.Offer(change, Instant.parse("2027-01-05T12:00:00Z"), 1000, "DKK", 10))
    }

    @Test
    fun `an offer that saves no time shows nothing`() {
        assertThat(EarlyUnlockLogic.show(offer(available = false, reason = "savesNoTime"), now, emptySet())).isNull()
        // Stale offer: the change is due before an unlock bought now would be.
        assertThat(EarlyUnlockLogic.show(offer(effectiveAt = now.plusSeconds(9 * 60)), now, emptySet())).isNull()
        assertThat(EarlyUnlockLogic.show(offer(effectiveAt = now.plusSeconds(11 * 60)), now, emptySet())).isNotNull()
    }

    @Test
    fun `the weekly cap says when the next one is possible, only when that helps`() {
        val next = Instant.parse("2027-01-05T08:00:00Z")
        assertThat(EarlyUnlockLogic.show(offer(available = false, reason = "weeklyCap", nextAvailableAt = next), now, emptySet()))
            .isEqualTo(EarlyUnlockShow.WeeklyCap(change, Instant.parse("2027-01-05T12:00:00Z"), next))
        val afterTheChange = Instant.parse("2027-01-06T08:00:00Z")
        assertThat(EarlyUnlockLogic.show(offer(available = false, reason = "weeklyCap", nextAvailableAt = afterTheChange), now, emptySet())).isNull()
        assertThat(EarlyUnlockLogic.show(offer(available = false, reason = "weeklyCap", nextAvailableAt = now.minusSeconds(1)), now, emptySet())).isNull()
    }

    @Test
    fun `a scheduled unlock shows its time and the withdrawal, also after keep waiting`() {
        val o = offer(available = false, reason = "inProgress", purchase = purchase("scheduled"))
        val expected = EarlyUnlockShow.Scheduled(change, "22222222-0000-4000-8000-000000000009", Instant.parse("2027-01-04T12:10:00Z"), true)
        assertThat(EarlyUnlockLogic.show(o, now, emptySet())).isEqualTo(expected)
        assertThat(EarlyUnlockLogic.show(o, now, setOf(change))).isEqualTo(expected)
        // Withdrawn (refund on its way): nothing left to do here.
        assertThat(EarlyUnlockLogic.show(offer(available = false, reason = "inProgress", purchase = purchase("refund_due")), now, emptySet())).isNull()
    }

    @Test
    fun `keep waiting is remembered and the offer does not come back`() {
        assertThat(EarlyUnlockLogic.show(offer(), now, setOf(change))).isNull()
    }

    @Test
    fun `only delay-key changes from the rules are offered`() {
        val shown = EarlyUnlockLogic.forRules(rules(), listOf(offer(), offer(changeId = buddyChange)), now, emptySet())
        assertThat(shown.map { it.changeId }).containsExactly(change)
        assertThat(EarlyUnlockLogic.forRules(rules(profile = "child"), listOf(offer()), now, emptySet())).isEmpty()
    }

    @Test
    fun `pay stays disabled until the consent is ticked`() {
        assertThat(EarlyUnlockLogic.payEnabled(consentTicked = false, busy = false)).isFalse()
        assertThat(EarlyUnlockLogic.payEnabled(consentTicked = true, busy = false)).isTrue()
        assertThat(EarlyUnlockLogic.payEnabled(consentTicked = true, busy = true)).isFalse()
    }

    @Test
    fun `the price is written from minor units`() {
        assertThat(EarlyUnlockLogic.price(1000, "DKK", Locale.US)).contains("10.00")
        assertThat(EarlyUnlockLogic.price(2995, "EUR", Locale.GERMANY)).contains("29,95")
    }

    // --- the device API ------------------------------------------------------------------------

    private lateinit var server: HttpServer
    @Volatile private var status = 200
    @Volatile private var body = "{}"
    private val seen = java.util.Collections.synchronizedList(mutableListOf<Triple<String, String, String>>())
    private val api get() = PlainphoneApi("http://127.0.0.1:${server.address.port}")

    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            seen += Triple(ex.requestMethod, ex.requestURI.path, ex.requestBody.readBytes().decodeToString())
            val bytes = body.toByteArray()
            ex.sendResponseHeaders(status, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    @After
    fun stop() = server.stop(0)

    @Test
    fun `offers are read from the server`() {
        body = OFFERS
        val offers = api.earlyUnlockOffers("pp_d_token")
        assertThat(offers).hasSize(2)
        assertThat(offers[0].available).isTrue()
        assertThat(offers[1].reason).isEqualTo("inProgress")
        assertThat(offers[1].purchase?.id).isEqualTo("22222222-0000-4000-8000-000000000009")
        assertThat(offers[1].purchase?.canWithdraw).isTrue()
        assertThat(seen.single().second).isEqualTo("/api/device/early-unlocks")
    }

    @Test
    fun `starting sends the consent and returns the ids for Google Play`() {
        status = 201
        body = """{"purchase":$PURCHASE,"productId":"early_unlock","accountId":"hh-1"}"""
        val start = api.startEarlyUnlock("pp_d_token", change)
        assertThat(start.productId).isEqualTo("early_unlock")
        assertThat(start.accountId).isEqualTo("hh-1")
        assertThat(start.purchase.id).isEqualTo("22222222-0000-4000-8000-000000000009")
        val (method, path, sent) = seen.single()
        assertThat(method to path).isEqualTo("POST" to "/api/device/early-unlocks")
        assertThat(JSONObject(sent).getBoolean("consent")).isTrue()
        assertThat(JSONObject(sent).getString("changeId")).isEqualTo(change)
    }

    @Test
    fun `a Play purchase is reported with its token and withdrawal is confirmed`() {
        body = PURCHASE
        api.reportPlayPurchase("pp_d_token", "earlyUnlock", "early_unlock", "token-0123456789")
        api.withdrawEarlyUnlock("pp_d_token", "22222222-0000-4000-8000-000000000009")
        assertThat(seen.map { it.second }).containsExactly(
            "/api/device/billing/play", "/api/device/early-unlocks/22222222-0000-4000-8000-000000000009/withdraw",
        ).inOrder()
        val report = JSONObject(seen[0].third)
        assertThat(report.getString("kind")).isEqualTo("earlyUnlock")
        assertThat(report.getString("purchaseToken")).isEqualTo("token-0123456789")
        assertThat(JSONObject(seen[1].third).getBoolean("confirm")).isTrue()
    }

    @Test
    fun `billing switched off is an error the screen can ignore`() {
        status = 404
        body = """{"error":"not found"}"""
        val e = runCatching { api.earlyUnlockOffers("pp_d_token") }.exceptionOrNull()
        assertThat(e).isInstanceOf(org.plainphone.app.sync.HttpError::class.java)
    }

    private companion object {
        val EARLY_UNLOCK: JSONObject get() = JSONObject().put("enabled", true).put("price", 1000).put("currency", "DKK")
        val PURCHASE = """{"id":"22222222-0000-4000-8000-000000000009","status":"scheduled","channel":"play","amount":1000,
            "currency":"DKK","consentAt":"2027-01-04T11:59:00Z","paidAt":"2027-01-04T12:00:00Z","unlockAt":"2027-01-04T12:10:00Z",
            "deliveredAt":null,"withdrawnAt":null,"refundedAt":null,"canWithdraw":true}"""
        val OFFERS = """{"offers":[
            {"changeId":"11111111-0000-4000-8000-000000000001","effectiveAt":"2027-01-05T12:00:00Z",
             "offer":{"available":true,"reason":null,"price":1000,"currency":"DKK","unlockMinutes":10,"nextAvailableAt":null,"purchase":null}},
            {"changeId":"11111111-0000-4000-8000-000000000003","effectiveAt":"2027-01-05T12:00:00Z",
             "offer":{"available":false,"reason":"inProgress","price":1000,"currency":"DKK","unlockMinutes":10,"nextAvailableAt":null,"purchase":$PURCHASE}}]}"""
    }
}
