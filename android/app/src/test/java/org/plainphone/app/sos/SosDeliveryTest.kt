// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.Manifest
import android.app.Application
import android.app.role.RoleManager
import android.content.Context
import android.net.ConnectivityManager
import android.os.Looper
import android.telecom.TelecomManager
import android.telephony.SmsManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.withTimeout
import org.plainphone.app.sync.PlainphoneApiKeepAliveTest.FreshNetworkShadow
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowRoleManager
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.plainphone.app.Compat
import org.plainphone.app.ConfigStore
import org.plainphone.app.PolicyConfig
import org.plainphone.app.sync.PlainphoneApiReleaseTest.PairedStore
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowSmsManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.plainphone.app.contacts.ApprovedContact
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class SosDeliveryTest {
    @Test
    @Config(sdk = [35], shadows = [PairedStore::class, FreshNetworkShadow::class, SmsPartsShadow::class])
    fun `worker hands off the fallback once and reports it on retry`(): Unit = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(context).grantPermissions(Manifest.permission.SEND_SMS)
        val roles = context.getSystemService(RoleManager::class.java)
        ShadowRoleManager.addRoleHolder(RoleManager.ROLE_SMS, context.packageName, android.os.Process.myUserHandle())
        assertThat(roles.isRoleHeld(RoleManager.ROLE_SMS)).isTrue()
        val at = System.currentTimeMillis()
        val rules = JSONObject(rulesJson(locationEnabled = false))
        rules.put("sos", JSONObject().put("name", "Child").put("parents", rules.getJSONArray("contacts")))
        SyncStore(context).saveRules("test", rules.toString(), at)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val reports = java.util.concurrent.CopyOnWriteArrayList<JSONObject>()
        server.createContext("/api/device/sos") { exchange ->
            reports.add(JSONObject(exchange.requestBody.readBytes().decodeToString()))
            exchange.sendResponseHeaders(503, -1)
            exchange.close()
        }
        val manager = context.getSystemService(ConnectivityManager::class.java)
        check(manager.bindProcessToNetwork(ShadowNetwork.newInstance(100)))
        server.start()
        try {
            ConfigStore(context).save(PolicyConfig(serverUrl = "http://127.0.0.1:${server.address.port}"))
            val input = workDataOf("id" to "report", "phone" to "test-phone", "at" to at, "kind" to "help")
            suspend fun deliver(attempt: Int) = TestListenableWorkerBuilder<SosWorker>(context)
                .setInputData(input).setRunAttemptCount(attempt).build().doWork()
            val sms = shadowOf(Compat.smsManager(context))
            assertThat(deliver(0)).isEqualTo(ListenableWorker.Result.retry())
            assertThat(SosDelivery.status(context, "report")).isEqualTo("sms")
            assertThat(SosDelivery.smsNames(context, "report")).containsExactly("Mum")
            assertThat(sms.lastSentMultipartTextMessageParams?.destinationAddress).isEqualTo("+4512345678")
            sms.clearLastSentMultipartTextMessageParams()

            assertThat(deliver(1)).isEqualTo(ListenableWorker.Result.retry())
            assertThat(sms.lastSentMultipartTextMessageParams).isNull()
            assertThat(reports.map { it.getBoolean("smsSubmitted") }).containsExactly(false, true).inOrder()
        } finally {
            server.stop(0)
            manager.bindProcessToNetwork(null)
        }
    }

    @Test
    @Config(sdk = [35], shadows = [PairedStore::class, FreshNetworkShadow::class])
    fun `an urgent retry calls without a screen and does not attach a newer position`(): Unit = runBlocking {
        val context = ApplicationProvider.getApplicationContext<Application>()
        shadowOf(context).grantPermissions(Manifest.permission.CALL_PHONE, Manifest.permission.ACCESS_FINE_LOCATION)
        val telecom = shadowOf(context.getSystemService(TelecomManager::class.java))
        telecom.setCallPhonePermission(true)
        val at = System.currentTimeMillis()
        val rules = JSONObject(rulesJson(locationEnabled = false))
        rules.put("sos", JSONObject().put("name", "Child").put("parents", rules.getJSONArray("contacts")))
        val sync = SyncStore(context)
        sync.saveRules("test", rules.toString(), at)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val reportCount = java.util.concurrent.atomic.AtomicInteger()
        val reports = java.util.concurrent.CopyOnWriteArrayList<JSONObject>()
        server.createContext("/api/device/sos") { exchange ->
            reports.add(JSONObject(exchange.requestBody.readBytes().decodeToString()))
            if (reportCount.incrementAndGet() == 1) {
                exchange.sendResponseHeaders(503, -1)
            } else {
                exchange.sendResponseHeaders(200, 2)
                exchange.responseBody.write("{}".toByteArray())
            }
            exchange.close()
        }
        val manager = context.getSystemService(ConnectivityManager::class.java)
        check(manager.bindProcessToNetwork(ShadowNetwork.newInstance(100)))
        server.start()
        try {
            ConfigStore(context).save(PolicyConfig(serverUrl = "http://127.0.0.1:${server.address.port}"))
            val input = workDataOf("id" to "urgent", "phone" to "test-phone", "at" to at, "kind" to "urgent")
            suspend fun deliver(attempt: Int) = TestListenableWorkerBuilder<SosWorker>(context)
                .setInputData(input).setRunAttemptCount(attempt).build().doWork()
            assertThat(deliver(0)).isEqualTo(ListenableWorker.Result.retry())
            assertThat(SosDelivery.status(context, "urgent")).isEqualTo("pending")
            assertThat(telecom.allOutgoingCalls).isEmpty()

            rules.getJSONObject("location").put("enabled", true).put("mode", "find")
            sync.saveRules("test-2", rules.toString(), at)
            val location = context.getSystemService(android.location.LocationManager::class.java)
            shadowOf(location).setLocationEnabled(true)
            shadowOf(location).simulateLocation(android.location.Location("gps").apply {
                latitude = 55.0
                longitude = 12.0
                accuracy = 10f
                time = at + 1
                elapsedRealtimeNanos = android.os.SystemClock.elapsedRealtimeNanos()
            })
            assertThat(org.plainphone.app.sync.LocationReader(context).current(precise = true, timeoutMs = 0)).isNotNull()
            withTimeout(5_000) {
                val result = async(Dispatchers.Default) { deliver(1) }
                while (!result.isCompleted) {
                    shadowOf(Looper.getMainLooper()).idle()
                    delay(10)
                }
                assertThat(result.await()).isEqualTo(ListenableWorker.Result.success())
            }
            assertThat(reports.last().has("location")).isFalse()
            assertThat(telecom.onlyOutgoingCall.address.schemeSpecificPart).isEqualTo("+4512345678")
        } finally {
            server.stop(0)
            manager.bindProcessToNetwork(null)
        }
    }

    @Implements(SmsManager::class)
    class SmsPartsShadow : ShadowSmsManager() {
        @Implementation
        fun divideMessage(text: String): ArrayList<String> = arrayListOf(text)
    }

    @Test
    fun `the same queued report cannot claim a second SMS attempt`() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val prefs = SosDelivery.prefs(context)
        val submitted = mutableListOf<String>()
        val mum = ApprovedContact("Mum", "+4512345678")
        val parents = listOf(mum, ApprovedContact("Dad", "+4587654321"), mum)
        val send: (String) -> Boolean = { number ->
            submitted.add(number)
            number == mum.number
        }
        assertThat(submitSosFallback(prefs, "report-a", 1_000, parents, send)).containsExactly(mum)
        assertThat(submitSosFallback(prefs, "report-a", 2_000, parents, send)).isEmpty()
        assertThat(submitted).containsExactly("+4512345678", "+4587654321").inOrder()
        assertThat(submitSosFallback(prefs, "report-b", 2_000, parents, send)).containsExactly(mum)
    }
}
