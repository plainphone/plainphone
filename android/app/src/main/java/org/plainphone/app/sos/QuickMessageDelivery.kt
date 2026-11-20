// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.InboxSend
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.sync.QuickSendAnswer
import org.plainphone.app.sync.SyncStore

/** What happens after the online attempt for an ordinary quick message. */
internal enum class QuickFallback { DONE, SMS, RETRY, GIVE_UP }

/** Where a sent quick message is, as the family inbox shows it. */
enum class SendState { SENDING, SENT, DELIVERED, SMS, FAILED }

/**
 * The contract (docs/sos.md): no parent device got a push ([QuickSendAnswer.notified] 0), the server
 * could not be reached, or it failed (5xx, or 404 from a server without the endpoint): send the text
 * by SMS. Over the server's limit it is recorded but quiet, so no SMS either; while the first send
 * with the same id is still notifying, ask again. Another client error means the message cannot be
 * delivered online; then it is not sent at all.
 */
internal fun quickMessageFallback(answer: QuickSendAnswer?, error: Throwable?): QuickFallback = when {
    answer != null -> when {
        answer.limited || answer.notified > 0 -> QuickFallback.DONE
        answer.pending -> QuickFallback.RETRY
        else -> QuickFallback.SMS
    }
    error is HttpError -> if (error.status >= 500 || error.status == 404) QuickFallback.SMS else QuickFallback.GIVE_UP
    error is IOException -> QuickFallback.SMS
    else -> QuickFallback.GIVE_UP
}

/**
 * One tap on a quick message. An ordinary one goes to the parents' devices via the server, with SMS as
 * the fallback; a code word is a silent SOS. The child sees the same thing for both.
 */
internal object QuickMessageDelivery {
    /** A quick message older than this is not worth sending any more. */
    internal const val GIVE_UP_MS = 30 * 60_000L

    /**
     * Queues the message and returns a key for [failed], or null when it could not be queued.
     */
    fun send(context: Context, message: QuickMessage, inbox: InboxSend? = null): String? {
        // A code word goes through SOS, also from the family inbox: it never joins the thread (docs/family-inbox.md).
        if (message.meansSos) return SilentSos.queue(context, "code", message.text)?.let { "sos:$it" }
        val sync = SyncStore(context)
        val phoneId = sync.phoneId ?: return null
        SilentSos.childSos(sync.rules()) ?: return null
        val prefs = prefs(context)
        val now = System.currentTimeMillis()
        val prune = prefs.edit()
        prefs.all.forEach { (key, value) -> if (value is Long && now - value > 86_400_000L) prune.remove(key) }
        prune.apply()
        val id = UUID.randomUUID().toString()
        val request = OneTimeWorkRequestBuilder<QuickMessageWorker>()
            .setInputData(workDataOf("id" to id, "phone" to phoneId, "text" to message.text, "at" to now, "inbox" to inbox?.kind))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("quick-$id", ExistingWorkPolicy.KEEP, request)
        return "quick:$id"
    }

    /** After an offline SMS from the family inbox: report it once there is a network, for the thread. */
    fun recordLater(context: Context, input: Data) {
        val request = OneTimeWorkRequestBuilder<QuickMessageWorker>()
            .setInputData(Data.Builder().putAll(input).putBoolean("record", true).build())
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("quick-record-${input.getString("id")}", ExistingWorkPolicy.KEEP, request)
    }

    /** How a message behind [key] (from [send]) is doing, for the family inbox. */
    fun state(context: Context, key: String): SendState = when {
        key.startsWith("quick:") -> {
            val id = key.removePrefix("quick:")
            val p = prefs(context)
            when {
                p.contains("failed:$id") -> SendState.FAILED
                p.contains("sms:$id") -> SendState.SMS
                p.contains("online:$id") -> SendState.DELIVERED
                p.contains("sent:$id") -> SendState.SENT
                else -> SendState.SENDING
            }
        }
        // A code word answers exactly like an ordinary message (docs/sos.md).
        key.startsWith("sos:") -> when (SosDelivery.status(context, key.removePrefix("sos:"))) {
            "failed" -> SendState.FAILED
            "sms" -> SendState.SMS
            "online" -> SendState.DELIVERED
            else -> SendState.SENDING
        }
        else -> SendState.SENT
    }

    /** True once the message behind [key] (from [send]) is known not to reach the parents. */
    fun failed(context: Context, key: String): Boolean = when {
        key.startsWith("quick:") -> prefs(context).contains("failed:${key.removePrefix("quick:")}")
        key.startsWith("sos:") -> SosDelivery.status(context, key.removePrefix("sos:")) == "failed"
        else -> false
    }

    fun prefs(context: Context) = context.getSharedPreferences("plainphone_quick_messages", Context.MODE_PRIVATE)

    internal fun expired(at: Long, now: Long) = now - at > GIVE_UP_MS
}

class QuickMessageWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val context = applicationContext
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        val text = inputData.getString("text") ?: return@withContext Result.failure()
        val at = inputData.getLong("at", 0)
        val sync = SyncStore(context)
        val sos = SilentSos.childSos(sync.rules())
        val token = sync.deviceToken()
        val prefs = QuickMessageDelivery.prefs(context)
        val inbox = inputData.getString("inbox")
        if (inputData.getBoolean("record", false)) return@withContext recordAfterSms(context, id, text, at, inbox)
        // The child is told when a message does not reach the parents. A Long, so the daily prune clears it.
        fun failure(): Result {
            prefs.edit().putLong("failed:$id", System.currentTimeMillis()).apply()
            return Result.failure()
        }
        if (inputData.getString("phone") != sync.phoneId || token == null || sos == null ||
            QuickMessageDelivery.expired(at, System.currentTimeMillis())
        ) return@withContext failure()
        var answer: QuickSendAnswer? = null
        var error: Throwable? = null
        try {
            answer = SosDelivery.api(context).sendQuickMessage(token, id, text, inbox?.let { InboxSend(it, at) })
        } catch (e: IOException) {
            error = e
        }
        when (quickMessageFallback(answer, error)) {
            QuickFallback.DONE -> {
                // For the family inbox's "delivered" or "sent": a parent device got it, or it was over the limit.
                prefs.edit().putLong(if (answer?.limited == true) "sent:$id" else "online:$id", System.currentTimeMillis()).apply()
                Result.success()
            }
            QuickFallback.RETRY -> Result.retry()
            QuickFallback.GIVE_UP -> failure()
            QuickFallback.SMS -> {
                val submitted = if (canSendSms(context)) {
                    submitSosFallback(prefs, id, at, sos.parents) { number -> submitSosSms(context, number, text) }
                } else emptyList()
                when {
                    submitted.isNotEmpty() -> {
                        prefs.edit().putLong("sms:$id", System.currentTimeMillis()).apply()
                        // The family inbox still gets it, with its own time, once the phone is online again.
                        if (inbox != null && answer == null) QuickMessageDelivery.recordLater(context, inputData)
                        Result.success()
                    }
                    // The server answered, so trying again online would only get the same answer.
                    answer != null -> failure()
                    else -> Result.retry()
                }
            }
        }
    }

    /** After an offline SMS: tell the server, so the thread has it. Nobody is notified again. */
    private fun recordAfterSms(context: Context, id: String, text: String, at: Long, inbox: String?): Result {
        val sync = SyncStore(context)
        val token = sync.deviceToken() ?: return Result.failure()
        if (inbox == null || inputData.getString("phone") != sync.phoneId || System.currentTimeMillis() - at > RECORD_GIVE_UP_MS) {
            return Result.failure()
        }
        return try {
            SosDelivery.api(context).sendQuickMessage(token, id, text, InboxSend(inbox, at, smsSent = true))
            Result.success()
        } catch (e: HttpError) {
            if (e.status >= 500) Result.retry() else Result.failure()
        } catch (_: IOException) {
            Result.retry()
        }
    }

    private companion object {
        /** A late report for the thread is not worth sending after a day: the thread keeps 30 days, but the message was an SMS by then. */
        const val RECORD_GIVE_UP_MS = 86_400_000L
    }
}
