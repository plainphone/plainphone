// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import org.plainphone.app.Compat
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.IBinder
import android.provider.Telephony
import android.telephony.SmsManager
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Decision
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.contactPolicy

private const val TAG = "Plainphone"

data class SmsMessage(val id: Long, val number: String, val body: String, val atMs: Long, val outgoing: Boolean, val failed: Boolean, val read: Boolean)

data class Conversation(val contact: ApprovedContact, val last: SmsMessage, val unread: Int)

/**
 * Reads and writes the phone's SMS store. As the default SMS app, Plainphone
 * is the only app that may write it, and it must store every message itself.
 */
object SmsStore {
    /** Bumped on every change, so open screens reload. */
    private val _changes = MutableStateFlow(0)
    val changes: StateFlow<Int> = _changes

    fun notifyChanged() {
        _changes.value++
    }

    private const val RECENT_LIMIT = 2000

    /** The newest messages, newest first. Only approved contacts are shown in the UI, see [conversations]. */
    fun recent(context: Context): List<SmsMessage> {
        val out = mutableListOf<SmsMessage>()
        val projection = arrayOf(
            Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE,
            Telephony.Sms.TYPE, Telephony.Sms.READ,
        )
        runCatching {
            context.contentResolver.query(
                Telephony.Sms.CONTENT_URI, projection, null, null, "${Telephony.Sms.DATE} DESC LIMIT $RECENT_LIMIT",
            )?.use { c ->
                while (c.moveToNext()) {
                    val type = c.getInt(4)
                    out += SmsMessage(
                        id = c.getLong(0),
                        number = c.getString(1).orEmpty(),
                        body = c.getString(2).orEmpty(),
                        atMs = c.getLong(3),
                        outgoing = type != Telephony.Sms.MESSAGE_TYPE_INBOX,
                        failed = type == Telephony.Sms.MESSAGE_TYPE_FAILED,
                        read = c.getInt(5) != 0,
                    )
                }
            }
        }.onFailure { Log.w(TAG, "cannot read SMS", it) }
        return out
    }

    /** One conversation per approved contact that has messages, newest first. Other senders stay hidden. */
    fun conversations(context: Context): List<Conversation> {
        val rules = ContactPolicySources.get(context).rules()
        return recent(context)
            .mapNotNull { m -> rules.contactFor(m.number)?.let { it to m } }
            .groupBy({ it.first.number }, { it })
            .map { (_, items) ->
                Conversation(items.first().first, items.first().second, items.count { !it.second.outgoing && !it.second.read })
            }
            .sortedByDescending { it.last.atMs }
    }

    /** Messages with [contact], oldest first. */
    fun thread(context: Context, contact: ApprovedContact): List<SmsMessage> {
        val rules = ContactPolicySources.get(context).rules()
        return recent(context).filter { rules.contactFor(it.number)?.number == contact.number }.reversed()
    }

    fun markRead(context: Context, messages: List<SmsMessage>) {
        val unread = messages.filter { !it.outgoing && !it.read }
        if (unread.isEmpty()) return
        val values = ContentValues().apply {
            put(Telephony.Sms.READ, 1)
            put(Telephony.Sms.SEEN, 1)
        }
        runCatching {
            for (m in unread) {
                context.contentResolver.update(Uri.withAppendedPath(Telephony.Sms.CONTENT_URI, m.id.toString()), values, null, null)
            }
        }
        notifyChanged()
    }

    fun insertIncoming(context: Context, number: String, body: String, atMs: Long, subId: Int) {
        val values = ContentValues().apply {
            put(Telephony.Sms.ADDRESS, number)
            put(Telephony.Sms.BODY, body)
            put(Telephony.Sms.DATE, System.currentTimeMillis())
            put(Telephony.Sms.DATE_SENT, atMs)
            put(Telephony.Sms.READ, 0)
            put(Telephony.Sms.SEEN, 0)
            put(Telephony.Sms.SUBSCRIPTION_ID, subId)
        }
        runCatching { context.contentResolver.insert(Telephony.Sms.Inbox.CONTENT_URI, values) }
            .onFailure { Log.e(TAG, "cannot store incoming SMS", it) }
        notifyChanged()
    }

    fun insertOutgoing(context: Context, number: String, body: String): Uri? {
        val values = ContentValues().apply {
            put(Telephony.Sms.ADDRESS, number)
            put(Telephony.Sms.BODY, body)
            put(Telephony.Sms.DATE, System.currentTimeMillis())
            put(Telephony.Sms.READ, 1)
            put(Telephony.Sms.SEEN, 1)
            put(Telephony.Sms.TYPE, Telephony.Sms.MESSAGE_TYPE_OUTBOX)
        }
        val uri = runCatching { context.contentResolver.insert(Telephony.Sms.CONTENT_URI, values) }.getOrNull()
        notifyChanged()
        return uri
    }

    fun setType(context: Context, uri: Uri, type: Int) {
        val values = ContentValues().apply { put(Telephony.Sms.TYPE, type) }
        runCatching { context.contentResolver.update(uri, values, null, null) }
        notifyChanged()
    }
}

/** Sends SMS, but only to approved contacts (and emergency numbers that accept SMS). */
object SmsSender {
    fun send(context: Context, number: String, body: String): Decision {
        val text = body.trim()
        val decision = contactPolicy(context).decide(
            ContactPolicySources.get(context).rules(), Channel.SMS, Direction.OUTGOING, number,
        )
        if (!decision.allowed) {
            TelephonyLog(context).recordBlocked(Channel.SMS, Direction.OUTGOING, number)
            return decision
        }
        if (text.isEmpty()) return Decision.Block("empty message")
        val uri = SmsStore.insertOutgoing(context, number, text)
        val sent = PendingIntent.getBroadcast(
            context, (uri?.hashCode() ?: 0),
            Intent(context, SmsSentReceiver::class.java).setData(uri),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        try {
            val sms = Compat.smsManager(context)
            val parts = sms.divideMessage(text)
            // Only the last part reports back; the message counts as sent when all parts are.
            val intents = ArrayList<PendingIntent?>(parts.size).apply {
                repeat(parts.size - 1) { add(null) }
                add(sent)
            }
            sms.sendMultipartTextMessage(number, null, parts, intents, null)
        } catch (e: Exception) {
            Log.e(TAG, "SMS send failed", e)
            uri?.let { SmsStore.setType(context, it, Telephony.Sms.MESSAGE_TYPE_FAILED) }
            return Decision.Block("could not send: ${e.javaClass.simpleName}")
        }
        return decision
    }

    private fun contactPolicy(context: Context) = context.contactPolicy()
}

/** Marks an outgoing message as sent or failed. Not exported. */
class SmsSentReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val uri = intent.data ?: return
        val type = if (resultCode == android.app.Activity.RESULT_OK) Telephony.Sms.MESSAGE_TYPE_SENT else Telephony.Sms.MESSAGE_TYPE_FAILED
        SmsStore.setType(context, uri, type)
    }
}

/**
 * Receives SMS as the default SMS app (SMS_DELIVER). Messages from approved
 * contacts are stored and shown; others are dropped without being stored, and
 * only the sender and time go to the local blocked log.
 */
class SmsDeliverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_DELIVER_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent)?.filterNotNull().orEmpty()
        if (parts.isEmpty()) return
        val subId = intent.getIntExtra("android.telephony.extra.SUBSCRIPTION_INDEX", -1)
        val policy = context.contactPolicy()
        val rules = ContactPolicySources.get(context).rules()
        // One broadcast can hold several parts of one long message.
        for ((sender, msgs) in parts.groupBy { it.displayOriginatingAddress.orEmpty() }) {
            val decision = policy.decide(rules, Channel.SMS, Direction.INCOMING, sender.ifBlank { null })
            if (!decision.allowed) {
                Log.i(TAG, "dropped incoming SMS: $decision")
                TelephonyLog(context).recordBlocked(Channel.SMS, Direction.INCOMING, sender)
                continue
            }
            val body = msgs.joinToString("") { it.displayMessageBody.orEmpty() }
            SmsStore.insertIncoming(context, sender, body, msgs.first().timestampMillis, subId)
            val name = rules.contactFor(sender)?.name ?: sender
            CallNotifications.showMessage(context, name, rules.contactFor(sender)?.number ?: sender, body)
        }
    }
}

/**
 * MMS arrives as a WAP push (WAP_PUSH_DELIVER). Required for the SMS role.
 * Phase 2 does not support MMS or group messages: they are dropped and
 * logged. Downloading MMS needs the carrier's MMSC settings and is phase 3+.
 */
class MmsWapPushReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.WAP_PUSH_DELIVER_ACTION) return
        Log.i(TAG, "MMS not supported yet; dropped a WAP push")
        TelephonyLog(context).recordBlocked(Channel.SMS, Direction.INCOMING, "MMS")
    }
}

/**
 * "Reply with a message" from the incoming-call screen (RESPOND_VIA_MESSAGE).
 * Required for the SMS role. Sends only to approved contacts.
 */
class RespondViaMessageService : Service() {
    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val number = intent?.data?.schemeSpecificPart?.substringBefore('?')
        val text = intent?.getStringExtra(Intent.EXTRA_TEXT)
        if (number != null && !text.isNullOrBlank()) SmsSender.send(this, number, text)
        stopSelf(startId)
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null
}
