// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.Context
import android.util.Log
import java.util.UUID
import org.json.JSONObject
import org.plainphone.app.contacts.ParentNumbers
import org.plainphone.app.sync.KeystoreSecretBox
import org.plainphone.app.sync.SecretBox

/** A text message that arrived while the phone could not decide who may see it. */
data class HeldMessage(val id: String, val atMs: Long, val sender: String, val body: String)

/**
 * Messages held for a parent's review (docs/contacts.md, "Held for review"). When handling an incoming
 * SMS fails, the message must not be lost, and it must not be shown to the child either, because the
 * phone could not check who sent it. It is kept here, sealed with a key that never leaves the keystore,
 * outside the system's message store. Only the PIN-protected parent screen reads it.
 *
 * Same retention as the blocked log (the newest [MAX_MESSAGES], kept until a parent clears them), plus an
 * age limit of [MAX_AGE_MS], because unlike the log this holds message text.
 */
class HeldSms(
    context: Context,
    private val box: SecretBox = sealer,
    private val now: () -> Long = System::currentTimeMillis,
) {
    private val prefs = context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    /** Newest first. Entries that cannot be opened (key gone, damaged) are skipped, never shown half-read. */
    fun messages(): List<HeldMessage> = synchronized(LOCK) { read().sortedByDescending { it.atMs } }

    fun count(): Int = messages().size

    /** False when the message could not be stored. */
    fun hold(sender: String, body: String, atMs: Long): Boolean = synchronized(LOCK) {
        runCatching {
            val message = HeldMessage(UUID.randomUUID().toString(), atMs, sender, body)
            write((read() + message).sortedByDescending { it.atMs })
        }.onFailure { Log.e(TAG, "cannot hold an SMS for review", it) }.isSuccess
    }

    fun discard(id: String) = synchronized(LOCK) { write(read().filterNot { it.id == id }) }

    fun clear() = synchronized(LOCK) { prefs.edit().remove(KEY).apply() }

    private fun read(): List<HeldMessage> {
        val cutoff = now() - MAX_AGE_MS
        return prefs.getString(KEY, null).orEmpty().lines().filter(String::isNotEmpty).mapNotNull { line ->
            runCatching {
                val o = JSONObject(box.open(line) ?: return@runCatching null)
                HeldMessage(o.getString("id"), o.getLong("at"), o.getString("from"), o.getString("body"))
            }.getOrNull()
        }.filter { it.atMs >= cutoff }
    }

    private fun write(list: List<HeldMessage>) {
        val kept = list.take(MAX_MESSAGES).joinToString("\n") {
            box.seal(JSONObject().put("id", it.id).put("at", it.atMs).put("from", it.sender).put("body", it.body).toString())
        }
        prefs.edit().putString(KEY, kept).apply()
    }

    companion object {
        const val MAX_MESSAGES = 100
        const val MAX_AGE_MS = 30L * 24 * 60 * 60_000
        private const val PREFS = "plainphone_held_sms"
        private const val KEY = "messages"
        private const val TAG = "Plainphone"
        private val LOCK = Any()

        /** Tests replace the keystore, which Robolectric does not have. */
        @Volatile internal var sealer: SecretBox = KeystoreSecretBox("plainphone_held_sms")
    }
}

/**
 * What the receiver does when handling an incoming SMS throws (the rules cannot be read, the decision
 * fails). A message from a number on the parents' copy ([ParentNumbers]) is stored and shown as usual,
 * because that is a parent and a parent must never be lost. Anything else goes to [HeldSms]: not stored
 * in the system, no notification, so the child never sees it before a parent has.
 */
internal object SmsFailsafe {
    fun onFailure(
        context: Context, sender: String, body: String, atMs: Long, subId: Int, error: Exception,
        deliver: (Context, String, String, Long, Int) -> Unit = ::deliverNormally,
    ) {
        Log.e("Plainphone", "handling an incoming SMS failed, falling back", error)
        val parent = runCatching {
            ParentNumbers(context).snapshot()?.takeIf { it.enforced }?.contains(sender) == true
        }.getOrDefault(false)
        if (parent && runCatching { deliver(context, sender, body, atMs, subId) }.isSuccess) return
        HeldSms(context).hold(sender, body, atMs)
    }

    private fun deliverNormally(context: Context, sender: String, body: String, atMs: Long, subId: Int) {
        SmsStore.insertIncoming(context, sender, body, atMs, subId, helpReply = false)
        CallNotifications.showMessage(context, sender, sender, body)
    }
}
