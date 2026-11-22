// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.net.ConnectivityManager
import android.os.SystemClock
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.work.workDataOf
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.ConfigStore
import org.plainphone.app.PolicyConfig
import org.plainphone.app.sync.PlainphoneApiKeepAliveTest.FreshNetworkShadow
import org.plainphone.app.sync.PlainphoneApiReleaseTest.PairedStore
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.shadows.ShadowNetwork

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [PairedStore::class, FreshNetworkShadow::class])
class SosSenderTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private lateinit var server: HttpServer
    private val reports = CopyOnWriteArrayList<Pair<JSONObject, String?>>()
    private var gate: CountDownLatch? = null

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val rules = JSONObject(rulesJson(locationEnabled = false))
        rules.put("sos", JSONObject().put("name", "Child").put("parents", rules.getJSONArray("contacts")))
        SyncStore(context).saveRules("test", rules.toString(), System.currentTimeMillis())
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.executor = java.util.concurrent.Executors.newCachedThreadPool()
        server.createContext("/api/device/sos") { exchange ->
            gate?.await(5, TimeUnit.SECONDS)
            reports.add(JSONObject(exchange.requestBody.readBytes().decodeToString()) to exchange.requestHeaders.getFirst("X-Plainphone-Elapsed-Ms"))
            exchange.sendResponseHeaders(200, 2)
            exchange.responseBody.write("{}".toByteArray())
            exchange.close()
        }
        check(context.getSystemService(ConnectivityManager::class.java).bindProcessToNetwork(ShadowNetwork.newInstance(100)))
        server.start()
        ConfigStore(context).save(PolicyConfig(serverUrl = "http://127.0.0.1:${server.address.port}"))
    }

    @After
    fun tearDown() {
        server.stop(0)
        context.getSystemService(ConnectivityManager::class.java).bindProcessToNetwork(null)
    }

    @Test
    fun `the SOS channel shows over everything, on the lock screen, without a sound`() {
        val notification = SosSender.notification(context)
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(SosSender.CHANNEL)
        assertThat(channel.importance).isEqualTo(NotificationManager.IMPORTANCE_HIGH)
        assertThat(channel.sound).isNull()
        assertThat(channel.lockscreenVisibility).isEqualTo(Notification.VISIBILITY_PUBLIC)
        assertThat(notification.channelId).isEqualTo(SosSender.CHANNEL)
        assertThat(notification.extras.getString(Notification.EXTRA_TITLE)).isEqualTo("Sending your SOS to your parents…")
    }

    @Test
    fun `a confirmed SOS starts sending at once with a visible notice and an expedited safety net`() {
        val id = SosDelivery.enqueue(context, "test-phone", SosKind.HELP)
        val started = shadowOf(context).nextStartedService
        assertThat(started.component).isEqualTo(ComponentName(context, SosSendService::class.java))
        assertThat(JSONObject(started.getStringExtra(SosSender.EXTRA_JOB)!!).getString("id")).isEqualTo(id)
        val work = WorkManager.getInstance(context).getWorkInfosForUniqueWork(id).get().single()
        assertThat(work.state).isAnyOf(WorkInfo.State.ENQUEUED, WorkInfo.State.RUNNING, WorkInfo.State.SUCCEEDED)
        // The safety net ran too: one report, no matter how many runners.
        assertThat(reports.map { it.first.getString("id") }).containsExactly(id)
    }

    @Test
    fun `a silent SOS sends without any notice`() {
        // The Play edition shows "Plainphone is on" all the time; the SOS must add nothing to it.
        val notifications = shadowOf(context.getSystemService(NotificationManager::class.java))
        val before = notifications.allNotifications.toList()
        SilentSos.queue(context, "clock")
        assertThat(shadowOf(context).nextStartedService).isNull()
        assertThat(notifications.allNotifications).containsExactlyElementsIn(before)
    }

    @Test
    fun `two runners report once and tell the server how long the press took`(): Unit = runBlocking {
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 3)
        val input = workDataOf(
            "id" to "same", "phone" to "test-phone", "kind" to "help", "at" to System.currentTimeMillis(),
            "elapsed" to SystemClock.elapsedRealtime(), "boot" to 3,
        )
        SosSender.remember(SosDelivery.prefs(context), input)
        org.robolectric.shadows.ShadowSystemClock.advanceBy(java.time.Duration.ofMillis(700))
        gate = CountDownLatch(1)
        val runs = List(2) { async(Dispatchers.IO) { SosDelivery.attempt(context, input, 0) } }
        Thread.sleep(200)
        gate!!.countDown()
        assertThat(runs.awaitAll()).containsExactly(ListenableWorker.Result.success(), ListenableWorker.Result.success())
        assertThat(reports).hasSize(1)
        assertThat(reports.single().second!!.toLong()).isAtLeast(700L)
        assertThat(SosDelivery.status(context, "same")).isEqualTo("online")
        // Delivered: nothing is left for the network watcher.
        assertThat(SosDelivery.prefs(context).contains("job:same")).isFalse()
    }

    @Test
    fun `no timing after a reboot`(): Unit = runBlocking {
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 4)
        val input = workDataOf("id" to "rebooted", "phone" to "test-phone", "kind" to "help", "at" to System.currentTimeMillis(), "elapsed" to 5L, "boot" to 3)
        assertThat(SosDelivery.attempt(context, input, 0)).isEqualTo(ListenableWorker.Result.success())
        assertThat(reports.single().second).isNull()
    }

    @Test
    fun `a new network sends a waiting SOS at once`() {
        val input = workDataOf("id" to "waiting", "phone" to "test-phone", "kind" to "help", "at" to System.currentTimeMillis())
        SosSender.remember(SosDelivery.prefs(context), input)
        SosSender.retryPending(context)
        val deadline = System.currentTimeMillis() + 5_000
        while (SosDelivery.prefs(context).contains("job:waiting") && System.currentTimeMillis() < deadline) Thread.sleep(20)
        assertThat(reports.map { it.first.getString("id") }).containsExactly("waiting")
        assertThat(SosDelivery.status(context, "waiting")).isEqualTo("online")
    }
}
