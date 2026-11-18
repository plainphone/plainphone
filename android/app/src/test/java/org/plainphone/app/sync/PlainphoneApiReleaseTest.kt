// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.content.Context
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.work.NetworkType
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.util.concurrent.TimeUnit
import org.plainphone.app.ConfigStore
import org.plainphone.app.R
import org.plainphone.app.light.LightRelease
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.UndoSetupAction
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Before
import org.junit.Test
import org.junit.Rule
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements

/** Release and setup undo against a local server. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PlainphoneApiReleaseTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var server: HttpServer
    @Volatile private var answer = 204
    private val seen = mutableListOf<Triple<String, String, String?>>()


    @Before
    fun start() {
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            seen += Triple(ex.requestMethod, ex.requestURI.path, ex.requestHeaders.getFirst("Authorization"))
            ex.requestBody.close()
            ex.sendResponseHeaders(answer, -1)
            ex.close()
        }
        server.start()
    }

    @After
    fun stop() {
        server.stop(0)
    }

    private fun api() = PlainphoneApi("http://127.0.0.1:${server.address.port}")

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `undo switches off locally without contacting the server and queues one report`() {
        val context = completeSetup()
        SyncStore(context, FakeSecretBox()).savePaired("test-phone", "test-token")
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        compose.setContent { UndoSetupAction(compose.activity, 0) }
        compose.onNodeWithText(context.getString(R.string.setup_undo)).assertIsDisplayed().performClick()

        compose.waitUntil(5_000) { LightRelease.isReleased(context) }
        val manager = WorkManager.getInstance(context)
        fun reports() = manager.getWorkInfosForUniqueWork("plainphone-sync-finish-undo").get(5, TimeUnit.SECONDS)
        compose.waitUntil(5_000) { reports().size == 1 }
        assertThat(reports().single().constraints.requiredNetworkType).isEqualTo(NetworkType.CONNECTED)
        assertThat(seen).isEmpty()
    }

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `reboot closes the window even if elapsed time would still allow undo`() {
        val context = completeSetup()
        assertThat(LightSetup.localUndoDeadline(context)).isGreaterThan(0L)
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 2)
        assertThat(LightSetup.localUndoDeadline(context)).isEqualTo(0L)
    }

    private fun completeSetup(): Context {
        val context = ApplicationProvider.getApplicationContext<Context>()
        Settings.Global.putInt(context.contentResolver, Settings.Global.BOOT_COUNT, 1)
        val config = ConfigStore(context)
        config.save(config.load().copy(serverUrl = "http://127.0.0.1:${server.address.port}"))
        LightSetup.saveProfile(context, "self")
        LightSetup.markComplete(context)
        return context
    }

    @Implements(SyncStore::class)
    class PairedStore {
        @Implementation fun isPaired(): Boolean = true
        @Implementation fun getPhoneId(): String = "test-phone"
        @Implementation fun deviceToken(): String = "test-token"
    }

    @Test
    fun `setup undo reports with the paired token and accepts a lost acknowledgement`() {
        answer = 503
        assertThrows(HttpError::class.java) { api().reportSetupUndo("test-token") }
        answer = 204
        api().reportSetupUndo("test-token")
        answer = 401
        api().reportSetupUndo("test-token")
        assertThat(seen).containsExactlyElementsIn(
            List(3) { Triple("POST", "/api/device/undo-setup", "Bearer test-token") },
        )
    }

    @Test
    fun `posts to the released endpoint with the device token`() {
        assertThat(api().ackReleased("pp_d_abc")).isTrue()
        assertThat(seen.single()).isEqualTo(Triple("POST", "/api/device/released", "Bearer pp_d_abc"))
    }

    @Test
    fun `204 and 401 both mean the phone is gone from the server`() {
        answer = 204
        assertThat(api().ackReleased("t")).isTrue()
        answer = 401
        assertThat(api().ackReleased("t")).isTrue()
    }

    @Test
    fun `409 means nobody asked for a release`() {
        answer = 409
        assertThat(api().ackReleased("t")).isFalse()
    }

    @Test
    fun `any other answer is an error to try again later`() {
        answer = 500
        assertThrows(HttpError::class.java) { api().ackReleased("t") }
        answer = 429
        assertThrows(HttpError::class.java) { api().ackReleased("t") }
    }
}
