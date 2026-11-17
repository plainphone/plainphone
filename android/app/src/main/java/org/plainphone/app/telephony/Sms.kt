// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

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
import android.telephony.SmsMessage as PlatformSms
import java.util.UUID
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.plainphone.app.Compat
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.Channel
import org.plainphone.app.contacts.ContactRules
import org.plainphone.app.contacts.HelpReplies
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.Decision
import org.plainphone.app.contacts.Direction
import org.plainphone.app.contacts.TelephonyLog
import org.plainphone.app.contacts.contactPolicy

private const val TAG = "Plainphone"

data class SmsMessage(
    val id: Long,
    val number: String,
    val body: String,
    val atMs: Long,
    val outgoing: Boolean,
    val failed: Boolean,
    val read: Boolean,
    val sent: Boolean = false,
)

enum class SmsThreadKind { CONTACT, HELP, LEGACY }

data class SmsThread(val number: String, val kind: SmsThreadKind = SmsThreadKind.CONTACT) {
    fun contact(rules: ContactRules): ApprovedContact? = when (kind) {
        SmsThreadKind.CONTACT -> rules.contactFor(number)
        SmsThreadKind.HELP -> rules.helpContact(number, Channel.SMS)
        SmsThreadKind.LEGACY -> rules.replyHelpContact(number, Channel.SMS)?.let { ApprovedContact(it.number, it.number) }
    }
}

data class Conversation(val thread: SmsThread, val contact: ApprovedContact, val last: SmsMessage, val unread: Int)

internal fun smsThreads(
    messages: List<SmsMessage>, rules: ContactRules, helpReplyIds: Set<String>, legacyThrough: Long,
    ordinaryOutgoingIds: Set<String> = emptySet(),
): List<Pair<SmsThread, SmsMessage>> {
    val firstLegacySend = messages.asSequence()
        .filter { it.sent && it.id <= legacyThrough }
        .mapNotNull { message -> rules.replyHelpContact(message.number, Channel.SMS)?.number?.let { it to message.id } }
        .groupingBy { it.first }
        .fold(Long.MAX_VALUE) { first, entry -> minOf(first, entry.second) }

    return messages.mapNotNull { message ->
        val help = rules.helpContact(message.number, Channel.SMS)
        val ordinary = rules.contactFor(message.number)
        val thread = when {
            help != null && ((message.outgoing && message.id.toString() !in ordinaryOutgoingIds) ||
                message.id.toString() in helpReplyIds) ->
                SmsThread(help.number, SmsThreadKind.HELP)
            ordinary != null -> SmsThread(ordinary.number)
            help != null && message.id <= legacyThrough &&
                message.id > (firstLegacySend[help.number] ?: Long.MAX_VALUE) ->
                SmsThread(help.number, SmsThreadKind.LEGACY)
            else -> null
        }
        thread?.let { it to message }
    }
}

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
    private const val HELP_REPLY_IDS = "help_reply_ids"

    private const val ORDINARY_OUTGOING_IDS = "ordinary_outgoing_ids"
    private const val LEGACY_THROUGH = "legacy_through"

    private fun preferences(context: Context) = context.getSharedPreferences("plainphone_sms", Context.MODE_PRIVATE)

    private fun helpReplyIds(context: Context) = preferences(context).getStringSet(HELP_REPLY_IDS, emptySet()).orEmpty()

    @Synchronized
    private fun legacyThrough(context: Context): Long {
        val prefs = preferences(context)
        if (prefs.contains(LEGACY_THROUGH)) return prefs.getLong(LEGACY_THROUGH, 0)
        val lastId = runCatching {
            context.contentResolver.query(
                Telephony.Sms.CONTENT_URI, arrayOf(Telephony.Sms._ID), null, null, "${Telephony.Sms._ID} DESC LIMIT 1",
            )?.use { if (it.moveToFirst()) it.getLong(0) else 0L }
        }.getOrNull() ?: 0L
        // Persist the boundary before this version inserts any new messages.
        return if (prefs.edit().putLong(LEGACY_THROUGH, lastId).commit()) lastId else 0L
    }

    private fun classified(context: Context, rules: ContactRules): List<Pair<SmsThread, SmsMessage>> {
        val cutoff = legacyThrough(context)
        return smsThreads(
            recent(context), rules, helpReplyIds(context), cutoff,
            preferences(context).getStringSet(ORDINARY_OUTGOING_IDS, emptySet()).orEmpty(),
        )
    }

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
                        sent = type == Telephony.Sms.MESSAGE_TYPE_SENT,
                    )
                }
            }
        }.onFailure { Log.w(TAG, "cannot read SMS", it) }
        return out
    }

    /** One conversation per approved contact that has messages, newest first. Other senders stay hidden. */
    fun conversations(context: Context): List<Conversation> {
        val rules = ContactPolicySources.get(context).rules()
        return classified(context, rules)
            .groupBy({ it.first }, { it.second })
            .mapNotNull { (thread, messages) ->
                thread.contact(rules)?.let { contact ->
                    Conversation(thread, contact, messages.first(), messages.count { !it.outgoing && !it.read })
                }
            }
            .sortedByDescending { it.last.atMs }
    }

    /** Messages belonging to the same sender identity, oldest first. */
    fun thread(context: Context, thread: SmsThread): List<SmsMessage> {
        val rules = ContactPolicySources.get(context).rules()
        return classified(context, rules).mapNotNull { (key, message) -> message.takeIf { key == thread } }.reversed()
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

    fun insertIncoming(
        context: Context, number: String, body: String, atMs: Long, subId: Int, helpReply: Boolean = false,
    ) {
        legacyThrough(context)
        val values = ContentValues().apply {
            put(Telephony.Sms.ADDRESS, number)
            put(Telephony.Sms.BODY, body)
            put(Telephony.Sms.DATE, System.currentTimeMillis())
            put(Telephony.Sms.DATE_SENT, atMs)
            put(Telephony.Sms.READ, 0)
            put(Telephony.Sms.SEEN, 0)
            put(Telephony.Sms.SUBSCRIPTION_ID, subId)
        }
        val id = runCatching { context.contentResolver.insert(Telephony.Sms.Inbox.CONTENT_URI, values) }
            .onFailure { Log.e(TAG, "cannot store incoming SMS", it) }
            .getOrNull()?.lastPathSegment?.toLongOrNull()
        if (helpReply && id != null) rememberId(context, HELP_REPLY_IDS, id)
        notifyChanged()
    }

    @Synchronized
    private fun rememberId(context: Context, key: String, id: Long) {
        val prefs = preferences(context)
        val ids = (prefs.getStringSet(key, emptySet()).orEmpty().mapNotNull(String::toLongOrNull) + id)
            .sortedDescending().take(RECENT_LIMIT).map(Long::toString).toSet()
        prefs.edit().putStringSet(key, ids).apply()
    }

    fun insertOutgoing(context: Context, number: String, body: String, ordinary: Boolean): Uri? {
        legacyThrough(context)
        val values = ContentValues().apply {
            put(Telephony.Sms.ADDRESS, number)
            put(Telephony.Sms.BODY, body)
            put(Telephony.Sms.DATE, System.currentTimeMillis())
            put(Telephony.Sms.READ, 1)
            put(Telephony.Sms.SEEN, 1)
            put(Telephony.Sms.TYPE, Telephony.Sms.MESSAGE_TYPE_OUTBOX)
        }
        val uri = runCatching { context.contentResolver.insert(Telephony.Sms.CONTENT_URI, values) }.getOrNull()
        if (ordinary) uri?.lastPathSegment?.toLongOrNull()?.let { rememberId(context, ORDINARY_OUTGOING_IDS, it) }
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
    fun send(context: Context, number: String, body: String, kind: SmsThreadKind? = null): Decision {
        val text = body.trim()
        val rules = ContactPolicySources.get(context).rules()
        val decision = contactPolicy(context).decide(rules, Channel.SMS, Direction.OUTGOING, number)
        if (!decision.allowed) {
            TelephonyLog(context).recordBlocked(Channel.SMS, Direction.OUTGOING, number)
            return decision
        }
        if (text.isEmpty()) return Decision.Block("empty message")
        val ordinary = kind == SmsThreadKind.CONTACT && rules.contactFor(number) != null
        val uri = SmsStore.insertOutgoing(context, number, text, ordinary && rules.helpContact(number, Channel.SMS) != null)
        val sendId = UUID.randomUUID().toString()
        val receipts = SmsSendReceipts(context)
        try {
            val sms = Compat.smsManager(context)
            val parts = sms.divideMessage(text)
            check(receipts.start(sendId, parts.size)) { "could not track SMS submission" }
            val intents = ArrayList(parts.indices.map { part ->
                PendingIntent.getBroadcast(
                    context, 0,
                    Intent(context, SmsSentReceiver::class.java)
                        .setIdentifier("$sendId:$part").setData(uri)
                        .putExtra("sendId", sendId).putExtra("part", part)
                        .putExtra("helpReplyNumber", rules.replyHelpContact(number, Channel.SMS)?.number),
                    PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_ONE_SHOT,
                )
            })
            sms.sendMultipartTextMessage(number, null, parts, intents, null)
        } catch (e: Exception) {
            receipts.cancel(sendId)
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
        val sendId = intent.getStringExtra("sendId") ?: return
        val sent = SmsSendReceipts(context).receive(
            sendId, intent.getIntExtra("part", -1), resultCode == android.app.Activity.RESULT_OK,
        ) ?: return
        if (sent) {
            intent.getStringExtra("helpReplyNumber")?.let { HelpReplies(context).record(Channel.SMS, it) }
        }
        val type = if (sent) Telephony.Sms.MESSAGE_TYPE_SENT else Telephony.Sms.MESSAGE_TYPE_FAILED
        intent.data?.let { SmsStore.setType(context, it, type) }
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
        val format = intent.getStringExtra("format")
        for ((key, msgs) in parts.groupBy { it.originatingAddress.orEmpty() to it.isNumericHelpSender(format) }) {
            val (sender, numeric) = key
            val decision = policy.decide(rules, Channel.SMS, Direction.INCOMING, sender.ifBlank { null }, numeric)
            if (!decision.allowed) {
                Log.i(TAG, "dropped incoming SMS: $decision")
                TelephonyLog(context).recordBlocked(Channel.SMS, Direction.INCOMING, sender)
                continue
            }
            val body = msgs.joinToString("") { it.displayMessageBody.orEmpty() }
            val helpReply = if (numeric) rules.incomingHelpContact(sender, Channel.SMS) else null
            SmsStore.insertIncoming(context, sender, body, msgs.first().timestampMillis, subId, helpReply != null)
            val contact = helpReply ?: rules.contactFor(sender)
            CallNotifications.showMessage(
                context, contact?.name ?: sender, contact?.number ?: sender, body,
                privateOnLockScreen = rules.isHelpNumber(sender),
                helpReply = helpReply != null,
            )
        }
    }
}

private fun PlatformSms.isNumericHelpSender(format: String?): Boolean =
    format == "3gpp" && hasNumericGsmOrigin(pdu)

// A GSM alphanumeric address can decode to digits alone. Check the address type on the wire.
internal fun hasNumericGsmOrigin(pdu: ByteArray): Boolean {
    val serviceCentreLength = pdu.firstOrNull()?.toInt()?.and(0xff) ?: return false
    val firstOctet = pdu.getOrNull(serviceCentreLength + 1)?.toInt() ?: return false
    if (firstOctet and 0x03 != 0) return false // SMS-DELIVER
    val addressType = pdu.getOrNull(serviceCentreLength + 3)?.toInt() ?: return false
    return addressType and 0x80 != 0 && addressType and 0x70 != 0x50
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
