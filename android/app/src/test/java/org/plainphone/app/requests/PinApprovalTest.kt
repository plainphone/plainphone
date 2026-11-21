// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.requests

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.MaintenancePin
import org.plainphone.app.PinThrottle
import org.plainphone.app.PolicyConfig
import org.robolectric.RobolectricTestRunner

/** Approving a request on the phone with the parent PIN: the check, the saved approval and the report. */
@RunWith(RobolectricTestRunner::class)
class PinApprovalTest {
    private val salt = "00112233445566778899aabbccddeeff"
    private val config = PolicyConfig(pinHashHex = MaintenancePin.hash("482913", salt), pinSaltHex = salt)

    private class Store : PinThrottle.Store {
        override var failures = 0
        override var lockedUntil = 0L
    }

    private var now = 1_000_000L
    private val store = Store()
    private val throttle = PinThrottle(store) { now }

    private fun request(status: String = "pending", via: String? = null, id: String = "r1") = PhoneRequest.parse(
        JSONObject("""{"id":"$id","kind":"app","packageName":"com.example.game","name":null,"number":null,"status":"$status","decidedVia":${via?.let { "\"$it\"" }},"waitingForKey":false}"""),
    )

    // --- The PIN check ---

    @Test
    fun `the right PIN passes and clears the failures`() {
        store.failures = 3
        assertThat(ParentPinCheck.check("482913", config, throttle)).isEqualTo(PinResult.Correct)
        assertThat(store.failures).isEqualTo(0)
    }

    @Test
    fun `a wrong PIN counts and after five tries the phone makes you wait, also for the maintenance screen`() {
        repeat(PinThrottle.FREE_ATTEMPTS) { assertThat(ParentPinCheck.check("000000", config, throttle)).isEqualTo(PinResult.Wrong) }
        val wait = ParentPinCheck.check("482913", config, throttle)
        assertThat(wait).isEqualTo(PinResult.Wait(60))
        // The shared throttle: the maintenance screen is locked out by the same wrong tries.
        assertThat(throttle.remainingMs()).isGreaterThan(0)
        now += 61_000
        assertThat(ParentPinCheck.check("482913", config, throttle)).isEqualTo(PinResult.Correct)
    }

    @Test
    fun `the test PIN from setup never approves anything`() {
        val testPhone = PolicyConfig()
        assertThat(ParentPinCheck.check(MaintenancePin.DEFAULT_TEST_PIN, testPhone, throttle)).isEqualTo(PinResult.NoPin)
        assertThat(store.failures).isEqualTo(0)
    }

    // --- Approving ---

    private class Server {
        var answer: PhoneRequest? = null
        var failure: IOException? = null
        val reports = mutableListOf<String>()
    }

    private val saved = mutableSetOf<String>()
    private val server = Server()
    private val approval = PinApproval(
        check = { ParentPinCheck.check(it, config, throttle) },
        save = { saved += it },
        report = { id ->
            server.reports += id
            server.failure?.let { throw it }
            server.answer
        },
        reported = { saved -= it },
    )

    @Test
    fun `the right PIN saves the approval, reports it and clears the saved copy`() {
        server.answer = request("approved", via = "phone")
        val outcome = approval.approve("r1", "482913")
        assertThat(outcome).isEqualTo(PinApproval.Outcome.Reported(server.answer))
        assertThat(server.reports).containsExactly("r1")
        assertThat(saved).isEmpty()
    }

    @Test
    fun `offline, the approval is kept on the phone and goes out with the next sync`() {
        server.failure = IOException("offline")
        assertThat(approval.approve("r1", "482913")).isEqualTo(PinApproval.Outcome.Saved)
        assertThat(saved).containsExactly("r1")
    }

    @Test
    fun `a parent who answered first keeps the answer, and the phone shows it`() {
        server.answer = request("rejected", via = "parent")
        val outcome = approval.approve("r1", "482913") as PinApproval.Outcome.Reported
        assertThat(outcome.request?.status).isEqualTo(PhoneRequest.Status.REJECTED)
        assertThat(outcome.request?.approvedOnPhone).isFalse()
    }

    @Test
    fun `a wrong PIN reports nothing and saves nothing`() {
        assertThat(approval.approve("r1", "000000")).isEqualTo(PinApproval.Outcome.Wrong)
        assertThat(server.reports).isEmpty()
        assertThat(saved).isEmpty()
    }

    @Test
    fun `while waiting after too many tries nothing is reported even with the right PIN`() {
        repeat(PinThrottle.FREE_ATTEMPTS) { approval.approve("r1", "000000") }
        assertThat(approval.approve("r1", "482913")).isEqualTo(PinApproval.Outcome.Wait(60))
        assertThat(server.reports).isEmpty()
    }

    @Test
    fun `the PIN is not in the outcome or the saved copy`() {
        server.failure = IOException("offline")
        val outcome = approval.approve("r1", "482913")
        assertThat(outcome.toString()).doesNotContain("482913")
        assertThat(saved.toString()).doesNotContain("482913")
    }

    // --- The list ---

    @Test
    fun `an approval waiting to be reported shows as sending, not as waiting for a parent`() {
        val rows = requestRows(listOf(request(id = "r1"), request(id = "r2")), saved = setOf("r2")) { "Game" }
        assertThat(rows.map { it.state }).containsExactly(RowState.WAITING, RowState.SENDING).inOrder()
    }

    @Test
    fun `answers show the same words whoever gave them`() {
        val rows = requestRows(
            listOf(
                request("approved", via = "phone", id = "a"),
                request("approved", via = "parent", id = "b"),
                request("approved", via = null, id = "c"),
                request("rejected", via = "parent", id = "d"),
            ),
            saved = emptySet(),
        ) { "Game" }
        assertThat(rows.map { it.state }).containsExactly(
            RowState.APPROVED_ON_PHONE, RowState.APPROVED, RowState.APPROVED, RowState.DECLINED,
        ).inOrder()
    }

    @Test
    fun `a request that waits for the Self key says so`() {
        val r = PhoneRequest.parse(JSONObject("""{"id":"k","kind":"contact","name":"Gran","number":"+4512345678","status":"approved","waitingForKey":true}"""))
        assertThat(requestRows(listOf(r), emptySet()) { "Gran" }.single().state).isEqualTo(RowState.WAITING_KEY)
    }

    @Test
    fun `a request kind or status from a newer server is skipped, the rest of the list stays`() {
        val list = """{"requests":[{"id":"x","kind":"video","status":"pending"},
            {"id":"y","kind":"app","packageName":"com.example.a","status":"waiting-for-moon"},
            {"id":"z","kind":"app","packageName":"com.example.b","status":"pending"}]}"""
        assertThat(PhoneRequest.parseList(list).map { it.id }).containsExactly("z")
        assertThat(PhoneRequest.parseList("""{"requests":[]}""")).isEmpty()
    }

    @Test
    fun `a body that is not a request list is still an error, never an empty list`() {
        try {
            PhoneRequest.parseList("""{"error":"x"}""")
            error("should have failed")
        } catch (_: org.json.JSONException) {
            // expected
        }
    }
}
