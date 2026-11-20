// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import android.Manifest
import android.app.Application
import android.app.role.RoleManager
import android.net.ConnectivityManager
import android.os.Looper
import android.telecom.TelecomManager
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
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
import org.json.JSONObject
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.Compat
import org.plainphone.app.ConfigStore
import org.plainphone.app.PolicyConfig
import org.plainphone.app.sync.PlainphoneApiKeepAliveTest.FreshNetworkShadow
import org.plainphone.app.sync.PlainphoneApiReleaseTest.PairedStore
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowRoleManager

/** The silent SOS and quick messages: what goes to the server, what the phone does not do. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [PairedStore::class, FreshNetworkShadow::class, SosDeliveryTest.SmsPartsShadow::class])
class SilentSosTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val requests = CopyOnWriteArrayList<Pair<String, JSONObject>>()

    private fun saveRules() {
        val rules = JSONObject(rulesJson(locationEnabled = false))
        rules.put("sos", JSONObject().put("name", "Kim").put("parents", rules.getJSONArray("contacts")))
        SyncStore(context).saveRules("test", rules.toString(), System.currentTimeMillis())
    }

    private fun serve(status: Int, body: String, test: () -> Unit) {
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/device/") { exchange ->
            requests.add(exchange.requestURI.path to JSONObject(exchange.requestBody.readBytes().decodeToString()))
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

    private fun allowSms() {
        shadowOf(context).grantPermissions(Manifest.permission.SEND_SMS)
        ShadowRoleManager.addRoleHolder(RoleManager.ROLE_SMS, context.packageName, android.os.Process.myUserHandle())
    }

    private suspend inline fun <reified W : androidx.work.CoroutineWorker> work(vararg input: Pair<String, Any?>): ListenableWorker.Result =
        withTimeout(5_000) {
            val job = async(Dispatchers.Default) {
                TestListenableWorkerBuilder<W>(context).setInputData(workDataOf(*input)).build().doWork()
            }
            while (!job.isCompleted) {
                shadowOf(Looper.getMainLooper()).idle()
                delay(10)
            }
            job.await()
        }

    @Test
    fun `a hidden SOS reports its trigger and never calls`(): Unit = runBlocking {
        saveRules()
        shadowOf(context).grantPermissions(Manifest.permission.CALL_PHONE)
        val telecom = shadowOf(context.getSystemService(TelecomManager::class.java))
        telecom.setCallPhonePermission(true)
        serve(200, "{}") {
            runBlocking {
                val result = work<SosWorker>(
                    "id" to "hidden", "phone" to "test-phone", "kind" to "urgent", "at" to System.currentTimeMillis(), "trigger" to "power",
                )
                assertThat(result).isEqualTo(ListenableWorker.Result.success())
            }
        }
        val (path, payload) = requests.single()
        assertThat(path).isEqualTo("/api/device/sos")
        assertThat(payload.getString("kind")).isEqualTo("urgent")
        assertThat(payload.getString("trigger")).isEqualTo("power")
        assertThat(payload.has("message")).isFalse()
        assertThat(telecom.allOutgoingCalls).isEmpty()
        assertThat(SosDelivery.prefs(context).contains("call-claim:hidden")).isFalse()
        assertThat(SosDelivery.callMissed(context, "hidden")).isFalse()
    }

    @Test
    fun `a code word sends its text, and offline only the text goes by SMS`(): Unit = runBlocking {
        saveRules()
        allowSms()
        serve(503, "") {
            runBlocking {
                val result = work<SosWorker>(
                    "id" to "code", "phone" to "test-phone", "kind" to "urgent", "at" to System.currentTimeMillis(),
                    "trigger" to "code", "message" to "Blue bike",
                )
                assertThat(result).isEqualTo(ListenableWorker.Result.retry())
            }
        }
        val payload = requests.single().second
        assertThat(payload.getString("trigger")).isEqualTo("code")
        assertThat(payload.getString("message")).isEqualTo("Blue bike")
        val sms = shadowOf(Compat.smsManager(context)).lastSentMultipartTextMessageParams
        assertThat(sms?.destinationAddress).isEqualTo("+4512345678")
        assertThat(sms?.parts).containsExactly("Blue bike")
        assertThat(SosDelivery.status(context, "code")).isEqualTo("sms")
    }

    @Test
    fun `a silent SOS does not show on the SOS screen`() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        saveRules()
        val prefs = SosDelivery.prefs(context)
        val shown = SosDelivery.enqueue(context, "test-phone", SosKind.HELP)
        assertThat(prefs.getString("last:test-phone", null)).isEqualTo(shown)
        assertThat(SilentSos.send(context, "clock")).isTrue()
        assertThat(QuickMessageDelivery.send(context, QuickMessage("q", "Blue bike", meansSos = true))).isTrue()
        assertThat(prefs.getString("last:test-phone", null)).isEqualTo(shown)
    }

    @Test
    fun `a quick message no parent device got is sent by SMS`(): Unit = runBlocking {
        saveRules()
        allowSms()
        serve(200, """{"notified":0}""") {
            runBlocking {
                val result = work<QuickMessageWorker>(
                    "id" to "q1", "phone" to "test-phone", "text" to "Pick me up", "at" to System.currentTimeMillis(),
                )
                assertThat(result).isEqualTo(ListenableWorker.Result.success())
            }
        }
        val (path, payload) = requests.single()
        assertThat(path).isEqualTo("/api/device/quick-messages/send")
        assertThat(payload.getString("id")).isEqualTo("q1")
        assertThat(payload.getString("text")).isEqualTo("Pick me up")
        val sms = shadowOf(Compat.smsManager(context)).lastSentMultipartTextMessageParams
        assertThat(sms?.parts).containsExactly("Pick me up")
    }

    @Test
    fun `a quick message that reached a parent device sends no SMS`(): Unit = runBlocking {
        saveRules()
        allowSms()
        serve(200, """{"notified":2}""") {
            runBlocking {
                val result = work<QuickMessageWorker>(
                    "id" to "q2", "phone" to "test-phone", "text" to "I'm okay", "at" to System.currentTimeMillis(),
                )
                assertThat(result).isEqualTo(ListenableWorker.Result.success())
            }
        }
        assertThat(shadowOf(Compat.smsManager(context)).lastSentMultipartTextMessageParams).isNull()
    }
}
