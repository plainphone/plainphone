// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.Manifest
import android.app.Application
import android.app.role.RoleManager
import android.net.ConnectivityManager
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.workDataOf
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
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
import org.plainphone.app.sos.SosDeliveryTest.SmsPartsShadow
import org.plainphone.app.sync.PlainphoneApiKeepAliveTest.FreshNetworkShadow
import org.plainphone.app.sync.PlainphoneApiReleaseTest.PairedStore
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowNetwork
import org.robolectric.shadows.ShadowRoleManager

/** An SOS the server refuses, or cannot be told about, still reaches the parents by SMS and call. */
@RunWith(RobolectricTestRunner::class)
class SosRefusedTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()

    private fun deliver(answer: Int, kind: String, at: Long): ListenableWorker.Result = runBlocking {
        shadowOf(context).grantPermissions(Manifest.permission.SEND_SMS)
        ShadowRoleManager.addRoleHolder(RoleManager.ROLE_SMS, context.packageName, android.os.Process.myUserHandle())
        val rules = JSONObject(rulesJson(locationEnabled = false))
        rules.put("sos", JSONObject().put("name", "Child").put("parents", rules.getJSONArray("contacts")))
        SyncStore(context).saveRules("test", rules.toString(), at)
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/api/device/sos") { exchange ->
            exchange.sendResponseHeaders(answer, -1)
            exchange.close()
        }
        val manager = context.getSystemService(ConnectivityManager::class.java)
        check(manager.bindProcessToNetwork(ShadowNetwork.newInstance(100)))
        server.start()
        try {
            ConfigStore(context).save(PolicyConfig(serverUrl = "http://127.0.0.1:${server.address.port}"))
            val input = workDataOf("id" to "sos", "phone" to "test-phone", "at" to at, "kind" to kind)
            withTimeout(5_000) {
                val job = async(Dispatchers.Default) {
                    TestListenableWorkerBuilder<SosWorker>(context).setInputData(input).build().doWork()
                }
                while (!job.isCompleted) {
                    shadowOf(Looper.getMainLooper()).idle()
                    delay(10)
                }
                job.await()
            }
        } finally {
            server.stop(0)
            manager.bindProcessToNetwork(null)
        }
    }

    private fun smsTo() = shadowOf(Compat.smsManager(context)).lastSentMultipartTextMessageParams?.destinationAddress

    @Test
    @Config(sdk = [35], shadows = [PairedStore::class, FreshNetworkShadow::class, SmsPartsShadow::class])
    fun `a refused report still texts the parents`() {
        // 403 is what the server answers once the phone is released in the dashboard but has not synced yet.
        assertThat(deliver(403, "help", System.currentTimeMillis())).isEqualTo(ListenableWorker.Result.failure())
        assertThat(smsTo()).isEqualTo("+4512345678")
        assertThat(SosDelivery.status(context, "sos")).isEqualTo("sms")
    }

    @Test
    @Config(sdk = [35], shadows = [PairedStore::class, FreshNetworkShadow::class, SmsPartsShadow::class])
    fun `a refused urgent report still tries to call the parents`() {
        val at = System.currentTimeMillis() - CALL_RETRY_WINDOW_MS - 1
        deliver(401, "urgent", at)
        assertThat(smsTo()).isEqualTo("+4512345678")
        // The call was tried (and could not start in the test), so the child is told.
        assertThat(SosDelivery.callMissed(context, "sos")).isTrue()
    }

    @Test
    @Config(sdk = [35], shadows = [RemovedStore::class, FreshNetworkShadow::class, SmsPartsShadow::class])
    fun `a phone removed from the dashboard still texts the parents`() {
        assertThat(deliver(200, "help", System.currentTimeMillis())).isEqualTo(ListenableWorker.Result.failure())
        assertThat(smsTo()).isEqualTo("+4512345678")
        assertThat(SosDelivery.status(context, "sos")).isEqualTo("sms")
    }

    @Implements(SyncStore::class)
    class RemovedStore {
        @Implementation fun getPhoneId(): String = "test-phone"
        @Implementation fun deviceToken(): String? = null
    }
}
