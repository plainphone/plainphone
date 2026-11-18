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
    private val controller = PairingController(store, api, mapOf("model" to "Test"))

    @Test
    fun favouriteSetupSurvivesPairingWithoutRulesUntilExplicitlyCompleted() {
        val id = "7f1c2b9e-0000-4000-8000-000000000001"
        store.savePaired(id, "test-token")
        val reopened = SyncStore(context, FakeSecretBox())
        assertThat(reopened.favouriteSetupPhoneId()).isNull()
        reopened.saveRules("child", rulesJson(), 1)
        assertThat(reopened.favouriteSetupPhoneId()).isNull()
        reopened.saveRules("self", rulesJson().replace("\"child\"", "\"self\""), 2)
        assertThat(reopened.favouriteSetupPhoneId()).isEqualTo(id)

        reopened.completeFavouriteSetup(id)
        assertThat(SyncStore(context, FakeSecretBox()).favouriteSetupPhoneId()).isNull()
    }

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
        api.pollResult = PairPoll.Expired
        assertThat(controller.poll()).isEqualTo(PairPoll.Expired)
        assertThat(store.pairing()).isNull()
        api.pairing = api.pairing.copy(id = "p2", expiresAtMs = now + 15 * 60_000)
        assertThat(controller.start().id).isEqualTo("p2")
    }

    @Test
    fun `an automatic pairing can be recovered after its code expires`() {
        api.pairing = api.pairing.copy(expiresAtMs = now + 15 * 60_000, requiresConfirmation = false)
        val pairing = controller.start()
        now += 16 * 60_000
        assertThat(controller.start()).isEqualTo(pairing)
        api.pollResult = PairPoll.Paired("phone-1", "pp_d_secret")
        assertThat(controller.poll()).isInstanceOf(PairPoll.Paired::class.java)
        assertThat(store.isPaired).isTrue()
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

    @Test
    fun `a refused key preserves the setup link for correcting the choice`() {
        store.saveEnrollToken("pp_e_retry")
        store.confirmEnrollment()
        api.enrollResult = EnrollResult.InvalidKey

        assertThat(controller.enroll()).isEqualTo(EnrollResult.InvalidKey)
        assertThat(store.enrollToken()).isEqualTo("pp_e_retry")
        assertThat(store.enrollmentConfirmed).isFalse()

        store.confirmEnrollment()
        api.enrollResult = EnrollResult.Paired("phone", "pp_d_connected")
        assertThat(controller.enroll()).isEqualTo(EnrollResult.Paired("phone", "pp_d_connected"))
        assertThat(store.enrollToken()).isNull()
    }

    @Test
    fun `setup can finish after background enrollment without reopening pairing`() {
        val setup = now - 60_000
        store.saveEnrollToken("pp_e_3q2-7wEvR1q8aZ0sLx9Ywg")
        api.enrollResult = EnrollResult.Paired("phone-9", "pp_d_from_qr")
        controller.enroll()

        assertThat(PairingController.allowedWithoutPin(store.everPaired, setup, now)).isFalse()
        assertThat(PairingController.canFinishSetup(store.isPaired, setup, now)).isTrue()
        assertThat(PairingController.canFinishSetup(store.isPaired, setup, now + PairingController.FREE_PAIRING_MS)).isFalse()
        store.markRemoved()
        assertThat(PairingController.canFinishSetup(store.isPaired, setup, now)).isFalse()
    }

    @Test
    fun `the setup QR code's token pairs the phone without a code, once`() {
        store.saveEnrollToken("pp_e_3q2-7wEvR1q8aZ0sLx9Ywg")
        val account = PlainphoneApi.PollAccount("p***@example.org", "Household")
        api.enrollResult = EnrollResult.Paired("phone-9", "pp_d_from_qr", account)
        assertThat(controller.enroll()).isInstanceOf(EnrollResult.Paired::class.java)
        assertThat(store.isPaired).isTrue()
        assertThat(store.deviceToken()).isEqualTo("pp_d_from_qr")
        assertThat(store.phoneId).isEqualTo("phone-9")
        assertThat(store.enrollmentAccount()).isEqualTo(account)
        assertThat(store.everPaired).isTrue()
        assertThat(store.enrollToken()).isNull()
        assertThat(api.enrollCalls.single().first).isEqualTo("pp_e_3q2-7wEvR1q8aZ0sLx9Ywg")
        // Nothing more to do afterwards.
        assertThat(controller.enroll()).isNull()
        assertThat(api.enrollCalls).hasSize(1)
    }

    @Test
    fun `a refused token is dropped so the phone shows a code instead`() {
        store.saveEnrollToken("pp_e_used")
        api.enrollResult = EnrollResult.Rejected
        assertThat(controller.enroll()).isEqualTo(EnrollResult.Rejected)
        assertThat(store.enrollToken()).isNull()
        assertThat(store.isPaired).isFalse()
        assertThat(controller.enroll()).isNull()
    }

    @Test
    fun `a network error keeps the token and the same install id for the retry`() {
        store.saveEnrollToken("pp_e_retry")
        api.enrollFailure = java.io.IOException("offline")
        assertThrows(java.io.IOException::class.java) { controller.enroll() }
        assertThat(store.enrollToken()).isEqualTo("pp_e_retry")
        api.enrollFailure = null
        api.enrollResult = EnrollResult.Paired("p", "pp_d_x")
        controller.enroll()
        assertThat(api.enrollCalls.map { it.second }.distinct()).hasSize(1)
        assertThat(api.enrollCalls.first().second).matches("^[A-Za-z0-9_-]{24}$")
    }

    @Test
    fun `the token is stored sealed, never in plain text`() {
        store.saveEnrollToken("pp_e_secret_token_value")
        val raw = context.getSharedPreferences(SyncStore.PREFS, 0).all.values.joinToString()
        assertThat(raw).doesNotContain("pp_e_secret_token_value")
    }

    @Test
    fun `the pairing screen and the background worker never enroll at the same time`() {
        store.saveEnrollToken("pp_e_race")
        api.enrollResult = EnrollResult.Paired("p", "pp_d_one")
        api.enrollDelayMs = 200
        // Two controllers, like PairingActivity and EnrollWorker each make their own.
        val other = PairingController(store, api, mapOf("model" to "Test"))
        val threads = listOf(controller, other).map { c -> Thread { c.enroll() }.apply { start() } }
        threads.forEach { it.join() }
        assertThat(api.enrollCalls).hasSize(1)
        assertThat(store.deviceToken()).isEqualTo("pp_d_one")
    }
}
