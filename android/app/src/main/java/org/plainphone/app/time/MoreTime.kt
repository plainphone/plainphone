// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.annotation.SuppressLint
import android.content.SharedPreferences
import android.util.Log
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.MoreTimeRequest
import org.plainphone.app.sync.SyncApi
import org.plainphone.app.sync.TimeLimits

/**
 * "Ask for more time" on the child's side (docs/time-limits.md). The phone remembers its own asks,
 * sends them when it can (the stop screen at once, the sync loop otherwise) and shows the answer.
 * The bonus itself arrives with the rules ([TimeLimits.bonuses]); nothing here unlocks anything.
 */
object MoreTime {
    /** After this long without an answer the screen says so, and points to calling a parent. */
    const val NO_ANSWER_AFTER_MS = 30 * 60_000L
    private const val MINUTE = 60_000L

    /** What the stop screen shows. [Composing] only exists in the screen, never in the store. */
    sealed interface Ui {
        data object Offer : Ui
        data object Composing : Ui
        /** Saved on the phone, sent when it is online. */
        data object Saved : Ui
        data object Waiting : Ui
        data object NoAnswerYet : Ui
        /** [until] is the formatted end time, or null for the rest of the day. */
        data class Approved(val until: String?) : Ui
        data object Declined : Ui
        data object Expired : Ui
        /** The server said no to asking at all (switched off, or no limit any more). */
        data object Unavailable : Ui
    }

    /**
     * What the ask is about: the daily cap ([TimeLimits.TOTAL]) when the total is used up, else the
     * app's own cap. When neither is used up (a bonus arrived) it is the target of today's last ask
     * for [pkg] or the total, so the screen can still show the answer. Null: nothing to ask about.
     */
    fun target(evaluation: TimeLimits.Evaluation, pkg: String, latest: (String) -> MoreTimeAsk?): String? = when {
        evaluation.totalUsedUp -> TimeLimits.TOTAL
        evaluation.appRemainingMs[pkg] == 0L -> pkg
        else -> listOfNotNull(latest(pkg), latest(TimeLimits.TOTAL)).maxByOrNull { it.createdAtMs }?.target
    }

    /**
     * The screen state for today's last [ask] for a target.
     *
     * @param capNow today's cap for the target with bonuses, to see whether the answer has arrived
     * @param remainingMs time left for the app now (the smaller of its cap and the total)
     * @param endTime formats "now + ms" in the phone's clock format
     */
    fun ui(ask: MoreTimeAsk?, today: LocalDate, nowMs: Long, capNow: Int?, remainingMs: Long?, endTime: (Long) -> String): Ui {
        if (ask == null || ask.day != today) return Ui.Offer
        return when (ask.status) {
            MoreTimeAsk.Status.QUEUED -> Ui.Saved
            MoreTimeAsk.Status.PENDING -> if (nowMs - ask.createdAtMs >= NO_ANSWER_AFTER_MS) Ui.NoAnswerYet else Ui.Waiting
            MoreTimeAsk.Status.APPROVED -> {
                val arrived = capNow != null && ask.capAtAsk != null && capNow > ask.capAtAsk
                when {
                    // The extra time is used up as well: the child may ask again.
                    arrived && remainingMs == 0L -> Ui.Offer
                    ask.answer == "day" -> Ui.Approved(null)
                    else -> {
                        val ms = if (arrived && remainingMs != null) remainingMs else (ask.grantedMinutes ?: 0) * MINUTE
                        Ui.Approved(endTime(nowMs + ms))
                    }
                }
            }
            MoreTimeAsk.Status.DECLINED -> Ui.Declined
            MoreTimeAsk.Status.EXPIRED -> Ui.Expired
            MoreTimeAsk.Status.UNAVAILABLE -> Ui.Unavailable
        }
    }
}

/** One ask as the phone remembers it. [requestId] is null until the server has it. */
data class MoreTimeAsk(
    val target: String,
    val day: LocalDate,
    val reason: String?,
    val createdAtMs: Long,
    /** The target's cap when asking, so an arrived bonus can be told apart from used-up-again. */
    val capAtAsk: Int?,
    val status: Status = Status.QUEUED,
    val requestId: String? = null,
    val answer: String? = null,
    val grantedMinutes: Int? = null,
) {
    enum class Status { QUEUED, PENDING, APPROVED, DECLINED, EXPIRED, UNAVAILABLE }

    val open: Boolean get() = status == Status.QUEUED || status == Status.PENDING

    internal fun toJson(): JSONObject = JSONObject()
        .put("target", target).put("day", day.toString()).put("reason", reason ?: JSONObject.NULL)
        .put("createdAtMs", createdAtMs).put("capAtAsk", capAtAsk ?: JSONObject.NULL).put("status", status.name)
        .put("requestId", requestId ?: JSONObject.NULL).put("answer", answer ?: JSONObject.NULL)
        .put("grantedMinutes", grantedMinutes ?: JSONObject.NULL)

    internal companion object {
        fun parse(j: JSONObject) = MoreTimeAsk(
            target = j.getString("target"),
            day = LocalDate.parse(j.getString("day")),
            reason = if (j.isNull("reason")) null else j.getString("reason"),
            createdAtMs = j.getLong("createdAtMs"),
            capAtAsk = if (j.isNull("capAtAsk")) null else j.getInt("capAtAsk"),
            status = Status.valueOf(j.getString("status")),
            requestId = if (j.isNull("requestId")) null else j.getString("requestId"),
            answer = if (j.isNull("answer")) null else j.getString("answer"),
            grantedMinutes = if (j.isNull("grantedMinutes")) null else j.getInt("grantedMinutes"),
        )
    }
}

/**
 * Today's asks, kept in the sync prefs. Written with commit: an ask made offline must survive the
 * process dying before it is sent. Asks from earlier days are dropped on the next write.
 */
class MoreTimeAsks(private val prefs: SharedPreferences) {
    fun all(today: LocalDate): List<MoreTimeAsk> = read().filter { it.day == today }

    /** Today's last ask for [target]. */
    fun latest(target: String, today: LocalDate): MoreTimeAsk? = all(today).lastOrNull { it.target == target }

    /**
     * Saves a new ask, or returns the open one for the same target: the same thing is never asked twice.
     */
    fun ask(target: String, today: LocalDate, reason: String?, nowMs: Long, capAtAsk: Int?): MoreTimeAsk = synchronized(LOCK) {
        latest(target, today)?.takeIf { it.open }?.let { return@synchronized it }
        val ask = MoreTimeAsk(target, today, reason?.trim()?.take(org.plainphone.app.sync.MORE_TIME_REASON_MAX)?.ifEmpty { null }, nowMs, capAtAsk)
        write(all(today) + ask)
        ask
    }

    fun queued(today: LocalDate): List<MoreTimeAsk> = all(today).filter { it.status == MoreTimeAsk.Status.QUEUED }

    /** The server took [ask] (or already had an open one for its target). */
    fun sent(ask: MoreTimeAsk, request: MoreTimeRequest) = update(ask) { from(request, it) }

    fun unavailable(ask: MoreTimeAsk) = update(ask) { it.copy(status = MoreTimeAsk.Status.UNAVAILABLE) }

    /** Answers from the server's list, matched by request id. */
    fun merge(requests: List<MoreTimeRequest>, today: LocalDate) = synchronized(LOCK) {
        val byId = requests.associateBy { it.id }
        val asks = all(today)
        val merged = asks.map { ask -> ask.requestId?.let(byId::get)?.let { from(it, ask) } ?: ask }
        if (merged != asks) write(merged)
    }

    private fun from(r: MoreTimeRequest, ask: MoreTimeAsk) = ask.copy(
        requestId = r.id,
        status = when (r.status) {
            MoreTimeRequest.Status.PENDING -> MoreTimeAsk.Status.PENDING
            MoreTimeRequest.Status.APPROVED -> MoreTimeAsk.Status.APPROVED
            MoreTimeRequest.Status.DECLINED -> MoreTimeAsk.Status.DECLINED
            MoreTimeRequest.Status.EXPIRED -> MoreTimeAsk.Status.EXPIRED
        },
        answer = r.answer,
        grantedMinutes = r.grantedMinutes,
    )

    private fun update(ask: MoreTimeAsk, change: (MoreTimeAsk) -> MoreTimeAsk) = synchronized(LOCK) {
        val asks = all(ask.day)
        write(asks.map { if (it.target == ask.target && it.createdAtMs == ask.createdAtMs) change(it) else it })
    }

    private fun read(): List<MoreTimeAsk> = runCatching {
        val a = JSONArray(prefs.getString(KEY, null) ?: return emptyList())
        (0 until a.length()).map { MoreTimeAsk.parse(a.getJSONObject(it)) }
    }.onFailure { Log.w(TAG, "stored asks for more time do not parse: ${it.message}") }.getOrDefault(emptyList())

    @SuppressLint("ApplySharedPref")
    private fun write(asks: List<MoreTimeAsk>) {
        check(prefs.edit().putString(KEY, JSONArray(asks.map { it.toJson() }).toString()).commit()) { "could not save the ask" }
    }

    companion object {
        const val KEY = "more_time_asks"
        private const val TAG = "Plainphone"
        private val LOCK = Any()
    }
}

/** Sends saved asks and fetches answers. Shared by the stop screen and the sync loop. */
object MoreTimeOutbox {
    /**
     * Sends every saved ask. A network error throws and leaves the rest saved; 429 (too many) leaves it
     * saved for a later try; 400, 403 and 409 mean it can never go, so the screen says so.
     */
    fun send(asks: MoreTimeAsks, api: SyncApi, token: String, today: LocalDate) {
        for (ask in asks.queued(today)) {
            try {
                asks.sent(ask, api.askMoreTime(token, ask.target, ask.reason))
            } catch (e: HttpError) {
                when (e.status) {
                    400, 403, 409 -> asks.unavailable(ask)
                    else -> throw e
                }
            }
        }
    }

    /** Fetches the answers while something is waiting for one (or an answer may still change the screen). */
    fun refresh(asks: MoreTimeAsks, api: SyncApi, token: String, today: LocalDate) {
        if (asks.all(today).none { it.status == MoreTimeAsk.Status.PENDING }) return
        asks.merge(api.moreTimeRequests(token), today)
    }
}
