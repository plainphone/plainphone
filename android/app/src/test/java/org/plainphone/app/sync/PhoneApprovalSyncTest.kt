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
import org.plainphone.app.requests.PhoneRequest
import org.robolectric.RobolectricTestRunner

/**
 * Approval on the phone with the parent PIN, from the sync's point of view: the phone is the authority
 * for what it did, so an approval that did not get out is kept and sent again, and the server's answer
 * decides who was first.
 */
@RunWith(RobolectricTestRunner::class)
class PhoneApprovalSyncTest {
    private val context = ApplicationProvider.getApplicationContext<android.app.Application>()
    private lateinit var store: SyncStore
    private lateinit var api: FakeSyncApi
    private lateinit var runner: SyncRunner

    @Before
    fun setUp() {
        store = SyncStore(context, FakeSecretBox())
        api = FakeSyncApi()
        runner = SyncRunner(store, api, FakeSyncDevice())
        store.savePaired("7f1c2b9e-0000-4000-8000-000000000001", "pp_d_token")
    }

    private fun rules(pinApproval: Boolean?) {
        val extra = pinApproval?.let { "\"pinApprovalEnabled\":$it," }.orEmpty()
        api.rules = RulesResult.Changed("\"e${pinApproval}\"", rulesJson().replace("\"pollSeconds\":60", "$extra\"pollSeconds\":60"))
    }

    private fun request(id: String, status: String = "pending", via: String? = null) = PhoneRequest.parse(
        JSONObject("""{"id":"$id","kind":"app","packageName":"com.example.game","status":"$status","decidedVia":${via?.let { "\"$it\"" }},"waitingForKey":false}"""),
    )

    @Test
    fun `an approval saved on the phone is reported at the next sync, and then forgotten`() {
        rules(pinApproval = true)
        store.queuePhoneApproval("r1")
        runner.run("test")
        assertThat(api.approvedOnPhone).containsExactly("r1")
        assertThat(store.pendingPhoneApprovals()).isEmpty()
    }

    @Test
    fun `offline, it stays saved and is sent again, once the server answers`() {
        rules(pinApproval = true)
        store.queuePhoneApproval("r1")
        api.approveFailure = IOException("offline")
        runner.run("offline")
        assertThat(store.pendingPhoneApprovals()).containsExactly("r1")
        api.approveFailure = null
        runner.run("online")
        assertThat(api.approvedOnPhone).containsExactly("r1")
        assertThat(store.pendingPhoneApprovals()).isEmpty()
    }

    @Test
    fun `a request the server no longer knows is dropped, not retried for ever`() {
        rules(pinApproval = true)
        store.queuePhoneApproval("gone")
        api.approveAnswer = null
        runner.run("test")
        assertThat(store.pendingPhoneApprovals()).isEmpty()
    }

    @Test
    fun `the report is sent even if the parent switched approval on the phone off a moment ago`() {
        rules(pinApproval = false)
        store.queuePhoneApproval("r1")
        runner.run("test")
        assertThat(api.approvedOnPhone).containsExactly("r1")
    }

    @Test
    fun `the home screen counts the requests nobody has answered, except those approved on the phone`() {
        rules(pinApproval = true)
        api.requests = listOf(request("a"), request("b"), request("c", "approved", "parent"))
        store.queuePhoneApproval("b")
        api.approveFailure = IOException("offline")
        runner.run("test")
        assertThat(store.openRequests).isEqualTo(1)
    }

    @Test
    fun `with approval on the phone off the phone does not even ask for the list`() {
        rules(pinApproval = false)
        api.requests = listOf(request("a"))
        store.openRequests = 3
        runner.run("test")
        assertThat(store.openRequests).isEqualTo(0)
    }

    @Test
    fun `an older server that does not know the switch is read as off, because it has no endpoint`() {
        val parsed = ServerRules.parse(rulesJson())
        assertThat(parsed.pinApproval).isFalse()
        assertThat(parsed.silentBedtime).isTrue()
    }

    @Test
    fun `a list that cannot be fetched leaves the last count alone and does not fail the sync`() {
        rules(pinApproval = true)
        store.openRequests = 2
        api.requestsFailure = IOException("offline")
        val out = runner.run("test")
        assertThat(out).isInstanceOf(SyncRunner.Outcome.Synced::class.java)
        assertThat(store.openRequests).isEqualTo(2)
    }
}
