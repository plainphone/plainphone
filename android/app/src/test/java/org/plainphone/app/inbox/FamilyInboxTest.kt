// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.inbox

import android.Manifest
import android.app.Application
import android.app.role.RoleManager
import android.net.ConnectivityManager
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.work.workDataOf
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.plainphone.app.PolicyConfig
import org.plainphone.app.sos.QuickMessageDelivery
import org.plainphone.app.sos.QuickMessageWorker
import org.plainphone.app.sos.SendState
import org.plainphone.app.sos.SosDelivery
import org.plainphone.app.sync.InboxMessage
import org.plainphone.app.sync.InboxRules
import org.plainphone.app.sync.InboxThread
import org.plainphone.app.sync.PlainphoneApiKeepAliveTest.FreshNetworkShadow
import org.plainphone.app.sync.PlainphoneApiReleaseTest.PairedStore
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowRoleManager

/** The family inbox on the phone (docs/family-inbox.md). Synthetic fixtures; times are fixed numbers. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [PairedStore::class, FreshNetworkShadow::class, org.plainphone.app.sos.SosDeliveryTest.SmsPartsShadow::class])
class FamilyInboxTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val requests = CopyOnWriteArrayList<Pair<String, String>>()

    @Before
    fun workManager() = WorkManagerTestInitHelper.initializeTestWorkManager(context)

    private fun rules(inbox: JSONObject? = JSONObject().put("enabled", true).put("quickMessages", true).put("checkIns", true).put("latest", "r1")): ServerRules {
        val json = JSONObject(rulesJson(locationEnabled = false))
        json.put("sos", JSONObject().put("name", "Kim").put("parents", json.getJSONArray("contacts")))
        if (inbox != null) json.put("inbox", inbox)
        SyncStore(context).saveRules("test", json.toString(), 1_800_000_000_000L)
        return checkNotNull(SyncStore(context).rules())
    }

    /** A local server; [answer] gives status and body per request path. */
    private fun serve(answer: (String) -> Pair<Int, String>, test: () -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/device/") { exchange ->
            val path = exchange.requestURI.path
            requests.add(path to exchange.requestBody.readBytes().decodeToString())
            val (status, body) = answer(path)
            val bytes = body.toByteArray()
            exchange.sendResponseHeaders(status, if (bytes.isEmpty()) -1 else bytes.size.toLong())
            if (bytes.isNotEmpty()) exchange.responseBody.write(bytes)
            exchange.close()
        }
        val manager = context.getSystemService(ConnectivityManager::class.java)
        check(manager.bindProcessToNetwork(ShadowNetwork.newInstance(100)))
        server.start()
        try {
            ConfigStore(context).save(PolicyConfig(serverUrl = "http://127.0.0.1:${server.address.port}"))
            test()
        } finally {
            server.stop(0)
            manager.bindProcessToNetwork(null)
        }
    }

    private fun work(vararg input: Pair<String, Any?>): ListenableWorker.Result = runBlocking {
        withTimeout(5_000) {
            val job = async(Dispatchers.Default) {
                TestListenableWorkerBuilder<QuickMessageWorker>(context).setInputData(workDataOf(*input)).build().doWork()
            }
            while (!job.isCompleted) {
                shadowOf(Looper.getMainLooper()).idle()
                delay(10)
            }
            job.await()
        }
    }

    @Test
    fun `the rules block is off when missing, and switches follow it`() {
        assertThat(InboxRules.parse(null)).isEqualTo(InboxRules.OFF)
        assertThat(InboxRules.parse(JSONObject().put("enabled", false).put("checkIns", true))).isEqualTo(InboxRules.OFF)
        val on = InboxRules.parse(JSONObject().put("enabled", true).put("checkIns", true).put("latest", JSONObject.NULL))
        assertThat(on).isEqualTo(InboxRules(enabled = true, quickMessages = false, checkIns = true, latest = null))
        assertThat(rules(inbox = null).inbox.enabled).isFalse()
    }

    @Test
    fun `a message sent from the inbox carries its kind and original time, and shows as delivered`() {
        rules()
        serve({ 200 to """{"notified":2}""" }) {
            val result = work("id" to "m1", "phone" to "test-phone", "text" to "Pick me up", "at" to System.currentTimeMillis(), "inbox" to "quick")
            assertThat(result).isEqualTo(ListenableWorker.Result.success())
        }
        val body = JSONObject(requests.single().second)
        assertThat(body.getBoolean("inbox")).isTrue()
        assertThat(body.getString("kind")).isEqualTo("quick")
        assertThat(body.has("sentAt")).isTrue()
        assertThat(body.has("smsSent")).isFalse()
        assertThat(QuickMessageDelivery.state(context, "quick:m1")).isEqualTo(SendState.DELIVERED)
    }

    @Test
    fun `offline it goes by SMS now and fills in the thread later without notifying again`() {
        rules()
        shadowOf(context).grantPermissions(Manifest.permission.SEND_SMS)
        ShadowRoleManager.addRoleHolder(RoleManager.ROLE_SMS, context.packageName, android.os.Process.myUserHandle())
        val at = System.currentTimeMillis()
        serve({ 503 to "" }) {
            assertThat(work("id" to "m2", "phone" to "test-phone", "text" to "I'm home", "at" to at, "inbox" to "checkin"))
                .isEqualTo(ListenableWorker.Result.success())
        }
        assertThat(QuickMessageDelivery.state(context, "quick:m2")).isEqualTo(SendState.SMS)
        val later = WorkManager.getInstance(context).getWorkInfosForUniqueWork("quick-record-m2").get()
        assertThat(later).hasSize(1)
        requests.clear()
        serve({ 200 to """{"notified":0}""" }) {
            assertThat(work("id" to "m2", "phone" to "test-phone", "text" to "I'm home", "at" to at, "inbox" to "checkin", "record" to true))
                .isEqualTo(ListenableWorker.Result.success())
        }
        val body = JSONObject(requests.single().second)
        assertThat(body.getBoolean("smsSent")).isTrue()
        assertThat(body.getString("kind")).isEqualTo("checkin")
        assertThat(body.getString("sentAt")).isEqualTo(java.time.Instant.ofEpochMilli(at).toString())
    }

    @Test
    fun `a new reply is fetched once and gets its device receipt`() {
        val r = rules()
        val thread = JSONObject().put("recipients", JSONArray().put("Alex")).put(
            "messages",
            JSONArray().put(JSONObject().put("id", "r1").put("from", "parent").put("kind", "reply").put("text", "On my way")
                .put("sentAt", "2026-11-16T12:00:00Z").put("author", "Alex")),
        )
        serve({ path -> if (path.endsWith("/inbox")) 200 to thread.toString() else 204 to "" }) {
            FamilyInbox.refresh(context, SosDelivery.api(context), "token", r)
            // The same newest reply: nothing to fetch.
            FamilyInbox.refresh(context, SosDelivery.api(context), "token", r)
        }
        assertThat(requests.map { it.first }).containsExactly("/api/device/inbox", "/api/device/inbox/received").inOrder()
        assertThat(JSONObject(requests[1].second).getJSONArray("ids").getString(0)).isEqualTo("r1")
        assertThat(FamilyInbox.entries(context).single()).isEqualTo(
            InboxEntry("r1", false, "On my way", 1_794_830_400_000L, "reply", author = "Alex"),
        )
    }

    @Test
    fun `nothing is fetched while the inbox is off`() {
        val r = rules(inbox = null)
        serve({ 200 to "{}" }) { FamilyInbox.refresh(context, SosDelivery.api(context), "token", r) }
        assertThat(requests).isEmpty()
    }

    @Test
    fun `the thread merges the server copy with what is only on this phone, code words included`() {
        val server = InboxThread(
            listOf("Alex"),
            listOf(
                InboxMessage("a", true, "quick", "Pick me up", 1_000L, delivered = 0),
                InboxMessage("b", false, "reply", "On my way", 2_000L, author = "Alex"),
            ),
        )
        fun local(key: String, text: String, at: Long) = JSONObject().put("key", key).put("text", text).put("kind", "quick").put("at", at)
        val merged = FamilyInbox.merge(
            server,
            listOf(
                Triple("quick:a", local("quick:a", "Pick me up", 1_000L), SendState.SMS),
                Triple("sos:c", local("sos:c", "Is the blue bike home?", 3_000L), SendState.DELIVERED),
                Triple("quick:d", local("quick:d", "Call me", 1_500L), SendState.SENDING),
            ),
        )
        assertThat(merged.map { it.text }).containsExactly("Pick me up", "Call me", "On my way", "Is the blue bike home?").inOrder()
        assertThat(merged[0].state).isEqualTo(SendState.SMS)
        // A code word looks like any other message the child sent.
        assertThat(merged[3]).isEqualTo(InboxEntry("sos:c", true, "Is the blue bike home?", 3_000L, "quick", SendState.DELIVERED))
        assertThat(merged[1].state).isEqualTo(SendState.SENDING)
    }
}
