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
    /** Still in the outbox or queued: not handed to the network yet. */
    val pending: Boolean = false,
)

enum class SmsThreadKind { CONTACT, HELP, LEGACY, MMS }

data class SmsThread(
    val number: String,
    val kind: SmsThreadKind = SmsThreadKind.CONTACT,
    val systemId: Long? = null,
    val participants: List<String> = emptyList(),
) {
    fun contact(rules: ContactRules): ApprovedContact? = when (kind) {
        SmsThreadKind.CONTACT -> rules.contactFor(number)
        SmsThreadKind.HELP -> rules.helpContact(number, Channel.SMS)
        SmsThreadKind.LEGACY -> rules.replyHelpContact(number, Channel.SMS)?.let { ApprovedContact(it.number, it.number) }
        SmsThreadKind.MMS -> null
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

    private const val TRACKED_IDS_LIMIT = 2000
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
        }.getOrNull() ?: return 0L
        // Persist the boundary before this version inserts any new messages.
        return if (prefs.edit().putLong(LEGACY_THROUGH, lastId).commit()) lastId else 0L
    }

    internal fun threadPage(context: Context, after: ThreadCursor?, pageSize: Int): ThreadPage =
        SmsHistory(context).threads(after, pageSize)

    internal fun messagePage(context: Context, thread: SmsThread, after: SmsMessage?, pageSize: Int): List<SmsMessage> =
        SmsHistory(context).messages(thread, after, pageSize)

    internal fun partitions(
        context: Context, id: Long, number: String, rules: ContactRules,
    ): Map<SmsThreadKind, String> {
        if (rules.helpContact(number, Channel.SMS) == null) return mapOf(SmsThreadKind.CONTACT to "1")

        fun membership(ids: Set<String>): String {
            val numeric = ids.mapNotNull(String::toLongOrNull)
            return if (numeric.isEmpty()) "0" else "_id IN (${numeric.joinToString()})"
        }

        val ordinary = membership(preferences(context).getStringSet(ORDINARY_OUTGOING_IDS, emptySet()).orEmpty())
        val replies = membership(helpReplyIds(context))
        val help = "((type != ${Telephony.Sms.MESSAGE_TYPE_INBOX} AND NOT ($ordinary)) OR ($replies))"
        val boundary = legacyThrough(context)
        val first = if (rules.contactFor(number) == null && rules.replyHelpContact(number, Channel.SMS) != null) {
            context.contentResolver.queryHistoryPage(
                Telephony.Sms.CONTENT_URI, arrayOf(Telephony.Sms._ID),
                "thread_id = ? AND type = ? AND _id <= ?",
                arrayOf(id.toString(), Telephony.Sms.MESSAGE_TYPE_SENT.toString(), boundary.toString()), "_id ASC", 1,
            )?.use { if (it.moveToFirst()) it.getLong(0) else null }
        } else null
        val legacy = first?.let { "(_id > $it AND _id <= $boundary AND NOT $help)" }
        return buildMap {
            put(SmsThreadKind.CONTACT, "NOT $help" + if (legacy == null) "" else " AND NOT $legacy")
            put(SmsThreadKind.HELP, help)
            if (legacy != null) put(SmsThreadKind.LEGACY, legacy)
        }
    }

    fun markRead(context: Context, messages: List<SmsMessage>) {
        val unread = messages.filter { it.id > 0 && !it.outgoing && !it.read }
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
            .sortedDescending().take(TRACKED_IDS_LIMIT).map(Long::toString).toSet()
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
            // The approved number is texted, not the typed one (the rule matched the normalised form).
            sms.sendMultipartTextMessage(rules.contactFor(number)?.number?.takeIf { it.isNotBlank() } ?: number, null, parts, intents, null)
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
 * only the sender and time go to the local blocked log. If handling a message throws, it is not lost:
 * [SmsFailsafe] keeps it for a parent's review and the child does not see it.
 */
class SmsDeliverReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_DELIVER_ACTION) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent)?.filterNotNull().orEmpty()
        if (parts.isEmpty()) return
        val subId = intent.getIntExtra("android.telephony.extra.SUBSCRIPTION_INDEX", -1)
        val format = intent.getStringExtra("format")
        // One broadcast can hold several parts of one long message.
        for ((key, msgs) in parts.groupBy { it.originatingAddress.orEmpty() to it.isNumericHelpSender(format) }) {
            var stored = false
            try {
                handle(context, key.first, key.second, msgs, subId) { stored = true }
            } catch (e: Exception) {
                // Once the message is in the inbox it is not lost, and holding it as well would show it twice.
                if (!stored) SmsFailsafe.onFailure(
                    context, key.first, runCatching { msgs.joinToString("") { it.displayMessageBody.orEmpty() } }.getOrDefault(""),
                    msgs.first().timestampMillis, subId, e,
                )
            }
        }
    }

    private fun handle(context: Context, sender: String, numeric: Boolean, msgs: List<PlatformSms>, subId: Int, onStored: () -> Unit) {
        val rules = ContactPolicySources.get(context).rules()
        val decision = context.contactPolicy().decide(rules, Channel.SMS, Direction.INCOMING, sender.ifBlank { null }, numeric)
        if (!decision.allowed) {
            Log.i(TAG, "dropped incoming SMS: $decision")
            TelephonyLog(context).recordBlocked(Channel.SMS, Direction.INCOMING, sender)
            return
        }
        val body = msgs.joinToString("") { it.displayMessageBody.orEmpty() }
        val helpReply = if (numeric) rules.incomingHelpContact(sender, Channel.SMS) else null
        SmsStore.insertIncoming(context, sender, body, msgs.first().timestampMillis, subId, helpReply != null)
        onStored()
        val contact = helpReply ?: rules.contactFor(sender)
        CallNotifications.showMessage(
            context, contact?.name ?: sender, contact?.number ?: sender, body,
            privateOnLockScreen = rules.isHelpNumber(sender),
            helpReply = helpReply != null,
            // Silent bedtime: messages arrive without a sound or a heads-up, whoever sent them.
            quiet = rules.silentBedtime,
        )
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
