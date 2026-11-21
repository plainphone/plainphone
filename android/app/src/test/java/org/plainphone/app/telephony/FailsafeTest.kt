// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.telephony

import android.app.Application
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.provider.Telephony
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.After
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.ParentNumbers
import org.plainphone.app.contacts.UnreadableRules
import org.plainphone.app.sos.SosDeliveryTest.SmsPartsShadow
import org.plainphone.app.sync.FakeSecretBox
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/**
 * What the phone does when the rules cannot be read: outgoing calls (docs/always-reachable.md) and an
 * incoming SMS (docs/contacts.md, "Held for review"). The read is made to throw with
 * [ContactPolicySources.override]; the copy of the parents' numbers is written by a real rules read.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [SmsPartsShadow::class])
class FailsafeTest {
    private val context = ApplicationProvider.getApplicationContext<Application>()
    private val mum = "+4512345678"
    private val stranger = "+4587654321"
    private val emergency = listOf("112", "911", "114", "999", "110", "113")

    @Before fun setUp() {
        HeldSms.sealer = FakeSecretBox()
        val dpm = shadowOf(context.getSystemService(DevicePolicyManager::class.java))
        dpm.setActiveAdmin(PlainphoneAdminReceiver.component(context))
        assertThat(dpm.setDeviceOwner(PlainphoneAdminReceiver.component(context))).isTrue()
    }

    @After fun tearDown() {
        ContactPolicySources.override = null
    }

    private fun sync(json: String = rulesJson()) {
        SyncStore(context).saveRules("test", json, System.currentTimeMillis())
        // A real read of the rules, as every call and message does: this writes the parents' copy.
        ContactPolicySources.get(context).rules()
    }

    private fun breakRules() {
        ContactPolicySources.override = { throw IllegalStateException("rules cannot be read") }
    }

    private fun call(number: String?) = UnreadableRules.outgoingCall(context, number)

    private fun parentFile() = context.createDeviceProtectedStorageContext()
        .getSharedPreferences("plainphone_parent_numbers", Context.MODE_PRIVATE)

    // --- Outgoing calls --------------------------------------------------------------------------

    @Test fun `with a parent list, only the parents and emergency numbers can be called`() {
        sync()
        breakRules()
        assertThat(call(mum).allowed).isTrue()
        assertThat(call("+45 12 34 56 78").allowed).isTrue() // however it is written
        assertThat(call(stranger).allowed).isFalse()
        assertThat(call(null).allowed).isFalse()
        emergency.forEach { assertThat(call(it).allowed).isTrue() }
    }

    @Test fun `the list holds the parents the server marked, not every contact`() {
        val two = """[{"name":"Mum","number":"+4512345678"},{"name":"Friend","number":"+4587654321"}]"""
        val sos = """"sos":{"name":"Kid","parents":[{"name":"Mum","number":"+4512345678"}]},"""
        sync(rulesJson(contacts = two).replaceFirst("\"phoneId\"", sos + "\"phoneId\""))
        assertThat(ParentNumbers(context).snapshot()!!.numbers).containsExactly(mum)
        breakRules()
        assertThat(call(mum).allowed).isTrue()
        assertThat(call(stranger).allowed).isFalse()
    }

    @Test fun `with no parent marked, every approved contact is on the list`() {
        val two = """[{"name":"Mum","number":"+4512345678"},{"name":"Friend","number":"+4587654321"}]"""
        sync(rulesJson(contacts = two))
        breakRules()
        assertThat(call(mum).allowed).isTrue()
        assertThat(call(stranger).allowed).isTrue()
        assertThat(call("+4511111111").allowed).isFalse()
    }

    @Test fun `without a list the call stays open, and emergency numbers work`() {
        breakRules()
        assertThat(ParentNumbers(context).snapshot()).isNull()
        assertThat(call(stranger).allowed).isTrue()
        assertThat(call(null).allowed).isTrue()
        emergency.forEach { assertThat(call(it).allowed).isTrue() }
    }

    @Test fun `a damaged list counts as missing`() {
        sync()
        parentFile().edit().putString("list", "garbage").commit()
        breakRules()
        assertThat(ParentNumbers(context).snapshot()).isNull()
        assertThat(call(stranger).allowed).isTrue()
        emergency.forEach { assertThat(call(it).allowed).isTrue() }
    }

    @Test fun `corrupt stored rules do not touch the list`() {
        sync()
        // The rules file is replaced by garbage; the separate list is unaffected and still readable.
        context.getSharedPreferences("plainphone_sync", Context.MODE_PRIVATE).edit().clear().commit()
        breakRules()
        assertThat(call(mum).allowed).isTrue()
        assertThat(call(stranger).allowed).isFalse()
        emergency.forEach { assertThat(call(it).allowed).isTrue() }
    }

    @Test fun `a phone whose list was not limiting calls stays open`() {
        // Not locked: the contact list never limited anything, so the copy says so.
        ParentNumbers(context).remember(listOf(ApprovedContact("Mum", mum)), ContactRules(false, emptyList(), null))
        assertThat(ParentNumbers(context).snapshot()!!.enforced).isFalse()
        breakRules()
        assertThat(call(stranger).allowed).isTrue()
    }

    @Test fun `the list is only rewritten when it changes`() {
        sync()
        val before = ParentNumbers(context).snapshot()
        sync()
        assertThat(ParentNumbers(context).snapshot()).isEqualTo(before)
        sync(rulesJson(contacts = """[{"name":"Dad","number":"+4511111111"}]"""))
        assertThat(ParentNumbers(context).snapshot()!!.numbers).containsExactly("+4511111111")
    }

    @Test fun `the decision itself, in every case`() {
        val list = ParentNumbers.Snapshot(setOf(mum), "45", enforced = true)
        for (snapshot in listOf(list, null, list.copy(enforced = false))) {
            emergency.forEach { assertThat(UnreadableRules.decide(true, snapshot, it).allowed).isTrue() }
        }
        assertThat(UnreadableRules.decide(false, list, mum).allowed).isTrue()
        assertThat(UnreadableRules.decide(false, list, stranger).allowed).isFalse()
        assertThat(UnreadableRules.decide(false, null, stranger).allowed).isTrue()
    }

    // --- Incoming SMS ----------------------------------------------------------------------------

    private fun pdu(number: String): ByteArray {
        val digits = number.removePrefix("+")
        val semiOctets = (if (digits.length % 2 == 1) "${digits}F" else digits).chunked(2).joinToString("") { it.reversed() }
        val hex = "00" + "04" + "%02X".format(digits.length) + "91" + semiOctets + "00" + "00" + "62110221000000" + "02" + "E834"
        return hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
    }

    private fun deliver(from: String) = SmsDeliverReceiver().onReceive(
        context,
        Intent(Telephony.Sms.Intents.SMS_DELIVER_ACTION).putExtra("pdus", arrayOf<Any>(pdu(from))).putExtra("format", "3gpp"),
    )

    private fun notifications() = shadowOf(context.getSystemService(NotificationManager::class.java)).allNotifications

    private fun held() = HeldSms(context).messages()

    @Test fun `a message from a stranger is held when handling throws, and the child sees nothing`() {
        sync()
        breakRules()
        deliver(stranger)
        assertThat(held().map { it.sender }).containsExactly(stranger)
        assertThat(held().single().body).isEqualTo("hi")
        assertThat(notifications()).isEmpty()
        assertThat(inbox()).isEmpty()
    }

    @Test fun `a message from a parent is delivered as usual even when handling throws`() {
        sync()
        breakRules()
        deliver(mum)
        assertThat(held()).isEmpty()
        assertThat(notifications()).isNotEmpty()
    }

    @Test fun `with no list at all, a message is held rather than shown`() {
        breakRules()
        deliver(mum)
        assertThat(held()).hasSize(1)
        assertThat(notifications()).isEmpty()
    }

    @Test fun `held messages are sealed, so the stored text is not readable`() {
        sync()
        breakRules()
        deliver(stranger)
        val stored = context.getSharedPreferences("plainphone_held_sms", Context.MODE_PRIVATE).getString("messages", "")!!
        assertThat(stored).isNotEmpty()
        assertThat(stored).doesNotContain(stranger)
        assertThat(stored).doesNotContain("\"hi\"")
    }

    @Test fun `the parents see held messages on their screen and can delete them`() {
        sync()
        breakRules()
        deliver(stranger)
        deliver("+4511112222")
        val store = HeldSms(context)
        assertThat(store.count()).isEqualTo(2)
        store.discard(store.messages().first().id)
        assertThat(store.count()).isEqualTo(1)
        store.clear()
        assertThat(store.messages()).isEmpty()
    }

    @Test fun `retention is the newest hundred and nothing older than thirty days`() {
        var now = 1_000_000_000_000L
        val store = HeldSms(context, FakeSecretBox()) { now }
        repeat(HeldSms.MAX_MESSAGES + 5) { store.hold("+45000000$it", "m$it", now - it) }
        assertThat(store.count()).isEqualTo(HeldSms.MAX_MESSAGES)
        assertThat(store.messages().first().body).isEqualTo("m0") // newest first
        now += HeldSms.MAX_AGE_MS + 1
        assertThat(store.messages()).isEmpty()
    }

    @Test fun `an entry that cannot be opened is skipped, never shown half-read`() {
        val store = HeldSms(context, FakeSecretBox())
        store.hold(stranger, "text", System.currentTimeMillis())
        context.getSharedPreferences("plainphone_held_sms", Context.MODE_PRIVATE).edit()
            .putString("messages", "not-sealed-at-all").commit()
        assertThat(store.messages()).isEmpty()
    }

    private fun inbox(): List<String> =
        context.contentResolver.query(Telephony.Sms.Inbox.CONTENT_URI, arrayOf("body"), null, null, null)
            ?.use { c -> generateSequence { if (c.moveToNext()) c.getString(0) else null }.toList() }.orEmpty()
}
