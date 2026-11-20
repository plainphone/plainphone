// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.IOException
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.plainphone.app.sync.CallbackAnswer
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.SyncStore

/** Where the child's request for a callback is, as the SOS screen tells it. */
enum class CallbackStatus { WAITING, QUEUED, SENT, DONE, EXPIRED, FAILED }

/** What the worker does after an attempt to report the request. */
internal enum class CallbackNext { DONE, RETRY, GIVE_UP }

/** The phone's own record of one request: its id, when the child pressed, and the last state it heard. */
internal data class CallbackLocal(val id: String, val atMs: Long, val state: String)

/** A request is open for 24 hours, as on the server (docs/sos.md#asking-a-parent-to-call). */
internal const val CALLBACK_OPEN_MS = 24 * 3_600_000L

/**
 * The contract: a server answer is the truth (also "expired" or "done"). No network or a server error
 * (5xx, or 404 from a server without the endpoint) is retried until the request would have expired.
 * 403 means the parents switched it off since the phone last synced; another client error cannot be
 * delivered. No SMS: a request carries no number, and there is nobody to text on the child's behalf.
 */
internal fun callbackNext(answer: CallbackAnswer?, error: Throwable?, atMs: Long, nowMs: Long): CallbackNext = when {
    answer != null -> CallbackNext.DONE
    nowMs - atMs >= CALLBACK_OPEN_MS -> CallbackNext.GIVE_UP
    error is HttpError -> if (error.status >= 500 || error.status == 404) CallbackNext.RETRY else CallbackNext.GIVE_UP
    error is IOException -> CallbackNext.RETRY
    else -> CallbackNext.GIVE_UP
}

/** What the child sees for [local]; null when nothing was asked. Waiting and "sent" lapse by the phone's own clock. */
internal fun callbackStatus(local: CallbackLocal?, nowMs: Long): CallbackStatus? {
    if (local == null) return null
    val lapsed = nowMs - local.atMs >= CALLBACK_OPEN_MS
    return when (local.state) {
        "done" -> CallbackStatus.DONE
        "expired" -> CallbackStatus.EXPIRED
        "failed" -> CallbackStatus.FAILED
        "sent" -> if (lapsed) CallbackStatus.EXPIRED else CallbackStatus.SENT
        "queued" -> if (lapsed) CallbackStatus.EXPIRED else CallbackStatus.QUEUED
        else -> if (lapsed) CallbackStatus.EXPIRED else CallbackStatus.WAITING
    }
}

/** True while a request is still on its way to a parent: another tap would only repeat it. */
internal fun callbackOpen(status: CallbackStatus?) =
    status == CallbackStatus.WAITING || status == CallbackStatus.QUEUED || status == CallbackStatus.SENT

/**
 * "Ask a parent to call" (docs/sos.md#asking-a-parent-to-call). The phone remembers its own request, reports it
 * with the time the child pressed (also after being offline for hours), and asks the server how far it got.
 */
internal object CallbackDelivery {
    fun prefs(context: Context) = context.getSharedPreferences("plainphone_callback", Context.MODE_PRIVATE)

    /** True when this child phone's parents have switched the feature on. */
    fun enabled(context: Context): Boolean = SilentSos.childSos(SyncStore(context).rules())?.callback?.enabled == true

    fun local(context: Context): CallbackLocal? {
        val p = prefs(context)
        val id = p.getString("id", null) ?: return null
        return CallbackLocal(id, p.getLong("at", 0L), p.getString("state", "waiting") ?: "waiting")
    }

    fun status(context: Context, nowMs: Long = System.currentTimeMillis()) = callbackStatus(local(context), nowMs)

    private fun store(context: Context, id: String, atMs: Long, state: String) {
        prefs(context).edit().putString("id", id).putLong("at", atMs).putString("state", state).apply()
    }

    /**
     * One tap. Does nothing while an earlier request is still open (a second tap only repeats it), or when the
     * switch is off. Returns false when nothing was queued.
     */
    fun request(context: Context, nowMs: Long = System.currentTimeMillis()): Boolean {
        val sync = SyncStore(context)
        val phoneId = sync.phoneId ?: return false
        if (!enabled(context) || callbackOpen(status(context, nowMs))) return false
        val id = UUID.randomUUID().toString()
        store(context, id, nowMs, "waiting")
        val work = OneTimeWorkRequestBuilder<CallbackWorker>()
            .setInputData(workDataOf("id" to id, "phone" to phoneId, "at" to nowMs))
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork("callback-$id", ExistingWorkPolicy.KEEP, work)
        return true
    }

    /** Asks the server how a request that reached it is doing. Blocking: call it off the main thread. */
    fun refresh(context: Context) {
        val local = local(context) ?: return
        if (local.state != "queued" && local.state != "sent") return
        val token = SyncStore(context).deviceToken() ?: return
        val answer = try {
            SosDelivery.api(context).callbackRequest(token, local.id)
        } catch (_: IOException) {
            return
        }
        // Only the request this phone is looking at: a newer tap may have replaced it meanwhile.
        if (local(context)?.id == local.id) store(context, local.id, local.atMs, answer.state)
    }

    internal fun record(context: Context, id: String, atMs: Long, state: String) = store(context, id, atMs, state)
}

class CallbackWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result = withContext(Dispatchers.IO) {
        val context = applicationContext
        val id = inputData.getString("id") ?: return@withContext Result.failure()
        val at = inputData.getLong("at", 0L)
        val sync = SyncStore(context)
        val token = sync.deviceToken()
        fun finish(state: String): Result {
            if (CallbackDelivery.local(context)?.id == id) CallbackDelivery.record(context, id, at, state)
            return Result.failure()
        }
        if (inputData.getString("phone") != sync.phoneId || token == null) return@withContext finish("failed")
        var answer: CallbackAnswer? = null
        var error: Throwable? = null
        try {
            answer = SosDelivery.api(context).requestCallback(token, id, at)
        } catch (e: IOException) {
            error = e
        }
        when (callbackNext(answer, error, at, System.currentTimeMillis())) {
            CallbackNext.DONE -> {
                val state = checkNotNull(answer).state
                // A tap while another request was open joins it: the phone follows that one from now on.
                if (CallbackDelivery.local(context)?.id == id) CallbackDelivery.record(context, answer.id, at, state)
                Result.success()
            }
            CallbackNext.RETRY -> Result.retry()
            CallbackNext.GIVE_UP -> finish(if (System.currentTimeMillis() - at >= CALLBACK_OPEN_MS) "expired" else "failed")
        }
    }
}
