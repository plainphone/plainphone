// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.QuickMessage
import org.plainphone.app.sync.QuickSendAnswer
import org.plainphone.app.sync.SyncStore

/** What happens after the online attempt for an ordinary quick message. */
internal enum class QuickFallback { DONE, SMS, RETRY, GIVE_UP }

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
    fun send(context: Context, message: QuickMessage): String? {
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
            .setInputData(workDataOf("id" to id, "phone" to phoneId, "text" to message.text, "at" to now))
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("quick-$id", ExistingWorkPolicy.KEEP, request)
        return "quick:$id"
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
            answer = SosDelivery.api(context).sendQuickMessage(token, id, text)
        } catch (e: IOException) {
            error = e
        }
        when (quickMessageFallback(answer, error)) {
            QuickFallback.DONE -> Result.success()
            QuickFallback.RETRY -> Result.retry()
            QuickFallback.GIVE_UP -> failure()
            QuickFallback.SMS -> {
                val submitted = if (canSendSms(context)) {
                    submitSosFallback(prefs, id, at, sos.parents) { number -> submitSosSms(context, number, text) }
                } else emptyList()
                when {
                    submitted.isNotEmpty() -> Result.success()
                    // The server answered, so trying again online would only get the same answer.
                    answer != null -> failure()
                    else -> Result.retry()
                }
            }
        }
    }
}
