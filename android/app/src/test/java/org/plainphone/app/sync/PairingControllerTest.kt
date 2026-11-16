// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner

@RunWith(RobolectricTestRunner::class)
class PairingControllerTest {
    private val context = ApplicationProvider.getApplicationContext<android.app.Application>()
    private val store = SyncStore(context, FakeSecretBox())
    private val api = FakeSyncApi()
    private var now = 1_800_000_000_000L
    private val controller = PairingController(store, api, { now }, mapOf("model" to "Test"))

    @Test
    fun `start shows a code, polling stores the token once paired`() {
        api.pairing = api.pairing.copy(expiresAtMs = now + 15 * 60_000)
        val p = controller.start()
        assertThat(p.code).isEqualTo("K7MP4QXR")
        assertThat(store.pairing()).isEqualTo(p)
        assertThat(controller.poll()).isEqualTo(PairPoll.Waiting)
        assertThat(store.isPaired).isFalse()

        api.pollResult = PairPoll.Paired("phone-1", "pp_d_secret")
        assertThat(controller.poll()).isInstanceOf(PairPoll.Paired::class.java)
        assertThat(store.isPaired).isTrue()
        assertThat(store.deviceToken()).isEqualTo("pp_d_secret")
        assertThat(store.phoneId).isEqualTo("phone-1")
        assertThat(store.pairing()).isNull()
        assertThrows(IllegalStateException::class.java) { controller.start() }
    }

    @Test
    fun `an expired code is dropped and a fresh one fetched`() {
        api.pairing = api.pairing.copy(expiresAtMs = now + 15 * 60_000)
        controller.start()
        now += 15 * 60_000
        assertThat(controller.poll()).isEqualTo(PairPoll.Expired)
        assertThat(store.pairing()).isNull()
        api.pairing = api.pairing.copy(id = "p2", expiresAtMs = now + 15 * 60_000)
        assertThat(controller.start().id).isEqualTo("p2")
    }

    @Test
    fun `pairing without the PIN only at setup, and only once`() {
        val setup = 1_000_000L
        assertThat(PairingController.allowedWithoutPin(everPaired = false, firstLockAtMs = setup, nowMs = setup + 60_000)).isTrue()
        assertThat(PairingController.allowedWithoutPin(false, setup, setup + PairingController.FREE_PAIRING_MS + 1)).isFalse()
        assertThat(PairingController.allowedWithoutPin(true, setup, setup + 60_000)).isFalse()
        // Never locked (not Device Owner): no free pairing.
        assertThat(PairingController.allowedWithoutPin(false, null, setup)).isFalse()
    }
}
