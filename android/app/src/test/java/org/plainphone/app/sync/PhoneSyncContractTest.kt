// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.time.ZonedDateTime
import org.json.JSONObject
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PolicyConfig
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.SyncedContactPolicySource
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * End to end against the real server and PostgreSQL, without an emulator: the phone's own
 * code (PlainphoneApi, PairingController incl. enrollment, SyncRunner, SyncStore, ServerRules, EffectivePolicy)
 * talks HTTP to the server while this test plays the parent through the parent API.
 *
 * Skipped unless PLAINPHONE_E2E points at the fixture file written by
 * server/test/e2e/phone-sync-server.ts. Run it with scripts/e2e-phone-sync.sh.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PhoneSyncContractTest {
    private lateinit var url: String
    private lateinit var parentToken: String

    @Before
    fun fixture() {
        val path = System.getenv("PLAINPHONE_E2E")
        assumeTrue("PLAINPHONE_E2E not set; run scripts/e2e-phone-sync.sh", !path.isNullOrEmpty())
        val j = JSONObject(File(path!!).readText())
        url = j.getString("url")
        parentToken = j.getString("parentToken")
    }

    /** The parent's side, straight HTTP with the session token. */
    private fun parent(method: String, path: String, body: JSONObject? = null): Pair<Int, JSONObject?> {
        val conn = URL("$url/api$path").openConnection() as HttpURLConnection
        try {
            conn.requestMethod = method
            conn.setRequestProperty("Authorization", "Bearer $parentToken")
            conn.setRequestProperty("Accept", "application/json")
            if (body != null) {
                conn.doOutput = true
                conn.setRequestProperty("Content-Type", "application/json")
                conn.outputStream.use { it.write(body.toString().toByteArray()) }
            }
            val status = conn.responseCode
            val text = (if (status >= 400) conn.errorStream else conn.inputStream)?.bufferedReader()?.readText().orEmpty()
            return status to text.takeIf { it.startsWith("{") }?.let(::JSONObject)
        } finally {
            conn.disconnect()
        }
    }

    @Test
    fun `pair, sync rules, answer Find, report status, survive removal`() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val store = SyncStore(context, FakeSecretBox())
        val api = PlainphoneApi(url)
        val device = FakeSyncDevice(
            apps = listOf(
                InstalledApp("com.android.dialer", "Phone", core = true),
                InstalledApp("com.spotify.music", "Spotify", core = false),
                InstalledApp("com.example.game", "Game", core = false),
            ),
        ).apply {
            now = System.currentTimeMillis()
            // The server rejects times in the future, so the fake lock must use the real clock too.
            lock = lock.copy(appliedAtMs = now)
        }

        // 1. Pairing: the phone shows a code, the parent claims it, the phone gets its token.
        val pairing = PairingController(store, api, mapOf("model" to "Contract test"))
        val started = pairing.start()
        assertThat(started.requiresConfirmation).isFalse()
        val code = started.code
        assertThat(pairing.poll()).isEqualTo(PairPoll.Waiting)
        val (claimStatus, claimed) = parent(
            "POST", "/phones/claim",
            JSONObject().put("code", code).put("name", "Alma").put("profile", "child").put("timezone", "Europe/Copenhagen"),
        )
        assertThat(claimStatus).isEqualTo(201)
        val phoneId = claimed!!.getString("id")
        assertThat(pairing.poll()).isInstanceOf(PairPoll.Paired::class.java)
        assertThat(store.isPaired).isTrue()
        assertThat(store.phoneId).isEqualTo(phoneId)
        assertThat(store.enrollmentAccount()?.maskedEmail).isEqualTo("p***@example.test")
        assertThat(store.enrollmentAccount()?.householdName).isEqualTo("Home")

        // 2. First sync: apps reported, rules fetched and applied, status reported.
        val runner = SyncRunner(store, api, device)
        val first = runner.run("first")
        assertThat(first).isInstanceOf(SyncRunner.Outcome.Synced::class.java)
        // The apps were reported before the rules, so they are already in them.
        var rules = store.rules()!!
        assertThat(rules.phoneId).isEqualTo(phoneId)
        assertThat(rules.allowedApps).containsAtLeast("com.android.dialer", "com.spotify.music") // Danish starter pack
        assertThat(rules.hiddenApps).contains("com.example.game")
        assertThat(rules.dnsReady).isTrue()
        assertThat(rules.dnsHost).endsWith(".dns.plainphone.org")
        assertThat(rules.locationEnabled).isTrue()
        assertThat(device.applies).isNotEmpty()
        val (_, summary) = parent("GET", "/phones/$phoneId")
        assertThat(summary!!.getBoolean("dnsReady")).isTrue()
        val status = summary.getJSONObject("status")
        assertThat(status.getString("appVersion")).isEqualTo("0.1.2")
        assertThat(status.getBoolean("lockIntact")).isTrue()
        assertThat(status.getInt("batteryPct")).isEqualTo(64)

        val sosId = java.util.UUID.randomUUID().toString()
        val payload = JSONObject().put("id", sosId).put("kind", "urgent").put("battery", 64)
            .put("location", JSONObject().put("lat", 55.6).put("lon", 12.5))
        val token = store.deviceToken()!!
        assertThat(api.reportSos(token, payload).getString("id")).isEqualTo(sosId)
        assertThat(api.reportSos(token, payload).getString("id")).isEqualTo(sosId)
        val (_, sosHistory) = parent("GET", "/phones/$phoneId/sos")
        assertThat(sosHistory!!.getJSONArray("events").length()).isEqualTo(1)
        assertThat(api.sosStatus(token, sosId).isNull("seenAt")).isTrue()
        assertThat(parent("POST", "/phones/$phoneId/sos/$sosId/seen", JSONObject()).first).isEqualTo(200)
        assertThat(api.sosStatus(token, sosId).isNull("seenAt")).isFalse()

        val batteryPolicy = "battery exemption missing: self-update cannot run"
        val appliedLock = device.lock
        device.lock = appliedLock.copy(failedPolicies = listOf(batteryPolicy))
        runner.run("battery exemption removed")
        val (_, missingBattery) = parent("GET", "/phones/$phoneId")
        val missingStatus = missingBattery!!.getJSONObject("status")
        assertThat(missingStatus.getJSONArray("failedPolicies").getString(0)).isEqualTo(batteryPolicy)
        assertThat(missingStatus.getBoolean("lockIntact")).isTrue()
        device.lock = appliedLock.copy(failedPolicies = listOf(batteryPolicy, "private DNS"))
        runner.run("DNS policy failed")
        val (_, brokenLock) = parent("GET", "/phones/$phoneId")
        assertThat(brokenLock!!.getJSONObject("status").getBoolean("lockIntact")).isFalse()
        device.lock = appliedLock
        runner.run("battery exemption granted")
        val (_, grantedBattery) = parent("GET", "/phones/$phoneId")
        assertThat(grantedBattery!!.getJSONObject("status").getJSONArray("failedPolicies").length()).isEqualTo(0)

        // 3. The parent changes the rules; the next poll brings them, the one after is a 304.
        assertThat(parent("POST", "/phones/$phoneId/contacts", JSONObject().put("name", "Mum").put("number", "+4512345678")).first).isAnyOf(200, 201)
        assertThat(parent("PUT", "/phones/$phoneId/apps/com.example.game", JSONObject().put("allowed", true)).first).isAnyOf(200, 201, 204)
        val bedtime = JSONObject().put("kind", "bedtime").put("days", org.json.JSONArray(listOf(1, 2, 3, 4, 5, 6, 7)))
            .put("startMinute", 21 * 60).put("endMinute", 7 * 60).put("allowedPackages", org.json.JSONArray(listOf("com.spotify.music")))
        assertThat(parent("POST", "/phones/$phoneId/schedules", bedtime).first).isAnyOf(200, 201)
        assertThat(runner.run("changed")).isEqualTo(SyncRunner.Outcome.Synced(changed = true, pollSeconds = 60))
        rules = store.rules()!!
        assertThat(rules.allowedApps).contains("com.example.game")
        assertThat(SyncedContactPolicySource(context) { store.rules()?.contacts }.rules().contacts)
            .containsExactly(ApprovedContact("Mum", "+4512345678"))
        val qr = PolicyConfig()
        val tz = rules.timezone
        val noon = ZonedDateTime.now(tz).withHour(12).withMinute(0).toInstant()
        val night = ZonedDateTime.now(tz).withHour(23).withMinute(0).toInstant()
        assertThat(EffectivePolicy.merge(qr, rules, noon).allowedPackages).contains("com.example.game")
        val atNight = EffectivePolicy.merge(qr, rules, night)
        assertThat(atNight.server!!.windowActive).isTrue()
        assertThat(atNight.allowedPackages).containsExactly("com.spotify.music")
        assertThat(atNight.dnsHost).isEqualTo(rules.dnsHost)
        assertThat(runner.run("unchanged")).isEqualTo(SyncRunner.Outcome.Synced(changed = false, pollSeconds = 60))

        // 4. Find: the parent presses it, the phone answers once with a precise position.
        device.locationRequests.clear()
        assertThat(parent("POST", "/phones/$phoneId/locate").first).isAnyOf(200, 202, 204)
        device.now = System.currentTimeMillis()
        runner.run("find")
        assertThat(device.locationRequests).containsExactly(true)
        val (_, location) = parent("GET", "/phones/$phoneId/location")
        assertThat(location.toString()).contains("55.67")
        assertThat(store.rules()!!.locateRequestedAt).isNotNull() // the rules fetched before the answer
        runner.run("after find")
        assertThat(store.rules()!!.locateRequestedAt).isNull() // the server cleared the request
        assertThat(device.locationRequests).containsExactly(true)

        // 5. Removed in the dashboard: the phone keeps its last rules and stops.
        assertThat(parent("DELETE", "/phones/$phoneId").first).isAnyOf(200, 204)
        assertThat(runner.run("removed")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(store.rules()!!.contacts).containsExactly(ApprovedContact("Mum", "+4512345678"))
        assertThat(store.everPaired).isTrue()
        assertThat(Instant.ofEpochMilli(store.lastSyncAtMs!!)).isLessThan(Instant.now().plusSeconds(1))
    }

    @Test
    fun `light mode shows the account and waits for confirmation before pairing`() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val store = SyncStore(context, FakeSecretBox())
        val pairing = PairingController(
            store, PlainphoneApi(url), emptyMap(), mode = "light", profile = "child",
        )
        val started = pairing.start()
        assertThat(started.requiresConfirmation).isTrue()
        assertThat(pairing.poll()).isEqualTo(PairPoll.Waiting)
        val (status, claimed) = parent(
            "POST", "/phones/claim",
            JSONObject().put("code", started.code).put("name", "Light phone").put("profile", "child"),
        )
        assertThat(status).isEqualTo(201)
        assertThat(claimed!!.isNull("pairedAt")).isTrue()
        val review = pairing.poll() as PairPoll.Confirm
        assertThat(review.maskedEmail).isNotEmpty()
        assertThat(store.isPaired).isFalse()
        assertThat(pairing.decide(confirm = true)).isInstanceOf(PairPoll.Paired::class.java)
        assertThat(store.phoneId).isEqualTo(claimed.getString("id"))
        assertThat(store.enrollmentAccount()).isNull()
    }

    @Test
    fun `a phone set up with a dashboard QR code pairs itself with the enrollment token`() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val store = SyncStore(context, FakeSecretBox())
        val api = PlainphoneApi(url)

        // The parent adds a phone in the dashboard; the browser would put the token in the QR code.
        val (status, out) = parent(
            "POST", "/phones/enroll",
            JSONObject().put("name", "Bo").put("profile", "child").put("timezone", "Europe/Copenhagen"),
        )
        assertThat(status).isEqualTo(201)
        val phoneId = out!!.getJSONObject("phone").getString("id")
        assertThat(out.getJSONObject("phone").isNull("pairedAt")).isTrue()
        val token = out.getJSONObject("enrollment").getString("token")
        assertThat(out.getJSONObject("provisioning").getString("downloadUrl")).endsWith("/download/android")

        // Provisioning stores the token from the QR extras; the phone enrolls with its own code.
        val config = PolicyConfig.fromExtras(android.os.PersistableBundle().apply { putString(PolicyConfig.KEY_ENROLL, token) })
        store.saveEnrollToken(config.enrollToken)
        val pairing = PairingController(store, api, mapOf("model" to "Contract test"))
        assertThat(pairing.enroll()).isInstanceOf(EnrollResult.Paired::class.java)
        assertThat(store.isPaired).isTrue()
        assertThat(store.phoneId).isEqualTo(phoneId)
        assertThat(parent("GET", "/phones/$phoneId").second!!.isNull("pairedAt")).isFalse()

        // It syncs like any paired phone.
        val device = FakeSyncDevice().apply {
            now = System.currentTimeMillis()
            lock = lock.copy(appliedAtMs = now)
        }
        assertThat(SyncRunner(store, api, device).run("first")).isInstanceOf(SyncRunner.Outcome.Synced::class.java)
        assertThat(store.rules()!!.phoneId).isEqualTo(phoneId)

        // The token works once: another phone gets a refusal and falls back to a code.
        assertThat(api.enroll(token, "another-install-0000000000", emptyMap())).isEqualTo(EnrollResult.Rejected)
        assertThat(api.enroll("pp_e_AAAAAAAAAAAAAAAAAAAAAA", store.installId(), emptyMap())).isEqualTo(EnrollResult.Rejected)
    }

    @Test
    fun `release from the dashboard switches the phone off, deletes it on the server and ends the sync`() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val store = SyncStore(context, FakeSecretBox())
        val api = PlainphoneApi(url)
        val (_, out) = parent(
            "POST", "/phones/enroll",
            JSONObject().put("name", "Cleo").put("profile", "child").put("timezone", "Europe/Copenhagen"),
        )
        val phoneId = out!!.getJSONObject("phone").getString("id")
        // Never paired: there is nothing to release yet.
        assertThat(parent("POST", "/phones/$phoneId/release").first).isEqualTo(400)
        store.saveEnrollToken(out.getJSONObject("enrollment").getString("token"))
        val pairing = PairingController(store, api, mapOf("model" to "Contract test"))
        assertThat(pairing.enroll()).isInstanceOf(EnrollResult.Paired::class.java)
        val device = FakeSyncDevice().apply {
            now = System.currentTimeMillis()
            lock = lock.copy(appliedAtMs = now)
        }
        val runner = SyncRunner(store, api, device)
        assertThat(runner.run("first")).isInstanceOf(SyncRunner.Outcome.Synced::class.java)
        assertThat(store.rules()!!.release).isFalse()

        // The parent releases the phone: it is still on the dashboard, marked as releasing.
        assertThat(parent("POST", "/phones/$phoneId/release").first).isEqualTo(200)
        assertThat(parent("GET", "/phones/$phoneId").second!!.isNull("releaseRequestedAt")).isFalse()

        // The phone reads release: true, switches Plainphone off before any lock, and the server forgets it.
        val locks = device.applies.size
        assertThat(runner.run("release")).isEqualTo(SyncRunner.Outcome.Removed)
        assertThat(device.releases).isEqualTo(1)
        assertThat(device.applies).hasSize(locks)
        assertThat(store.released).isTrue()
        assertThat(store.removed).isTrue()
        assertThat(parent("GET", "/phones/$phoneId").first).isEqualTo(404)
        // The token is unknown now: the server answers 401, which the API reads as "already done".
        assertThat(api.fetchRules(store.deviceToken() ?: "pp_d_gone", null)).isEqualTo(RulesResult.Unpaired)
    }
}
