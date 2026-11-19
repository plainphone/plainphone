// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.requests

import java.io.IOException

/**
 * A parent next to the child approves a request on the phone itself with the parent PIN.
 *
 * The phone is the authority for what it did: once the PIN is right, the approval is saved on the
 * phone first and then reported. A report that does not get through is retried by the next sync, and
 * the server never refuses it. The server decides which answer came first, and the screen shows
 * what the server says, so the phone, the dashboard and the parent app always agree.
 * Pure logic, unit-tested on the JVM.
 */
class PinApproval(
    /** Checks the PIN with the same rate limit as the maintenance screen. Blocking. */
    private val check: (String) -> PinResult,
    /** Saves the approval on the phone, so it survives a restart before it is reported. */
    private val save: (String) -> Unit,
    /** Reports it to the server. The request as it stands, or null when there is nothing left to report. Blocking. */
    private val report: (String) -> PhoneRequest?,
    /** The server has heard it: the saved copy can go. */
    private val reported: (String) -> Unit,
) {
    sealed interface Outcome {
        /** The server has the approval. [request] shows who won; null when the server no longer knows the request. */
        data class Reported(val request: PhoneRequest?) : Outcome
        /** The PIN was right, but the phone is offline. It is saved and goes out with the next sync. */
        data object Saved : Outcome
        data object Wrong : Outcome
        data class Wait(val seconds: Int) : Outcome
        data object NoPin : Outcome
    }

    fun approve(requestId: String, pin: String): Outcome {
        when (val result = check(pin)) {
            PinResult.Correct -> Unit
            PinResult.Wrong -> return Outcome.Wrong
            PinResult.NoPin -> return Outcome.NoPin
            is PinResult.Wait -> return Outcome.Wait(result.seconds)
        }
        save(requestId)
        return try {
            val request = report(requestId)
            reported(requestId)
            Outcome.Reported(request)
        } catch (_: IOException) {
            Outcome.Saved
        }
    }
}

/** What the screen lists, in the order the server sent them. Pure, so it is tested on the JVM. */
fun requestRows(
    requests: List<PhoneRequest>,
    /** Requests approved on the phone that the server has not heard about yet. */
    saved: Set<String>,
    label: (PhoneRequest) -> String,
): List<RequestRow> = requests.map { r ->
    val state = when {
        r.pending && r.id in saved -> RowState.SENDING
        r.pending -> RowState.WAITING
        r.status == PhoneRequest.Status.REJECTED -> RowState.DECLINED
        r.approvedOnPhone -> RowState.APPROVED_ON_PHONE
        r.waitingForKey -> RowState.WAITING_KEY
        else -> RowState.APPROVED
    }
    RequestRow(r.id, r.kind, label(r), state)
}
