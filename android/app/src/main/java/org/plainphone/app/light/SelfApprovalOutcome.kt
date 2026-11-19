// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import androidx.annotation.StringRes
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.io.IOException
import org.plainphone.app.R
import org.plainphone.app.ui.QrCode

/**
 * What became of the request behind the QR code on this phone. The server answers with the same
 * words for the dashboard and the parent app, so every screen tells the same story.
 */
internal enum class ApprovalState(@StringRes val message: Int?) {
    Waiting(null),
    Approved(R.string.self_approval_outcome_approved),
    Declined(R.string.self_approval_outcome_declined),
    Cancelled(R.string.self_approval_outcome_cancelled),
    Failed(R.string.self_approval_outcome_failed),

    /** The two minutes ran out before anyone answered. */
    Expired(R.string.self_approval_outcome_expired);

    /** No more waiting: the QR code is of no use now. */
    val settled get() = this != Waiting

    companion object {
        /** The server's `state`. An unknown word means a newer server: keep waiting rather than guess. */
        fun fromServer(state: String?) = when (state) {
            "approved" -> Approved
            "declined" -> Declined
            "cancelled" -> Cancelled
            "failed" -> Failed
            else -> Waiting
        }
    }
}

internal const val APPROVAL_CODE_LIFETIME_MS = 120_000L
internal const val APPROVAL_POLL_MS = 3_000L

/**
 * Polls until the request is answered or the code runs out. A network hiccup is not an answer:
 * the next poll tries again, and the code still expires on time.
 */
internal suspend fun awaitApprovalState(
    elapsedMs: () -> Long,
    poll: suspend () -> ApprovalState,
    sleep: suspend (Long) -> Unit,
    onWaiting: () -> Unit = {},
): ApprovalState {
    while (elapsedMs() < APPROVAL_CODE_LIFETIME_MS) {
        sleep(minOf(APPROVAL_POLL_MS, (APPROVAL_CODE_LIFETIME_MS - elapsedMs()).coerceAtLeast(1)))
        val state = try {
            poll()
        } catch (_: IOException) {
            ApprovalState.Waiting
        }
        if (state.settled) return state
        onWaiting()
    }
    return ApprovalState.Expired
}

/**
 * The body of the "Ask for approval" dialog once a request is chosen: the code and who it is for
 * while waiting, then the result in place of the code. The result is one polite announcement.
 */
@Composable
internal fun SelfApprovalBody(url: String?, summary: String?, state: ApprovalState, onNewCode: () -> Unit = {}) {
    Column {
        summary?.let { Text(it) }
        val message = state.message
        if (message != null) {
            Text(
                stringResource(message),
                style = MaterialTheme.typography.titleMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
            if (state == ApprovalState.Expired) TextButton(onClick = onNewCode) { Text(stringResource(R.string.self_invite_new)) }
        } else if (url != null) {
            Text(stringResource(R.string.self_approval_scan))
            QrCode(url, Modifier.size(200.dp))
            Text(stringResource(R.string.self_approval_waiting), style = MaterialTheme.typography.bodyMedium)
        }
    }
}
