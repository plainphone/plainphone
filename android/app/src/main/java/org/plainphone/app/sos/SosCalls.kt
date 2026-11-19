// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.app.role.RoleManager
import android.content.Context
import android.telecom.Call
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.contacts.PhoneNumbers
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.telephony.CallManager
import org.plainphone.app.telephony.CallUi
import org.plainphone.app.ui.placeCall

internal object SosCalls {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var stopped = false
    val active = MutableStateFlow(false)
    var callId by mutableStateOf<Int?>(null)
        private set

    fun start(context: Context, phoneId: String, parents: List<ApprovedContact>) {
        if (parents.isEmpty() || active.value || CallManager.state.value.isNotEmpty()) return
        val role = context.getSystemService(RoleManager::class.java)
        val canTrackCall = role?.isRoleHeld(RoleManager.ROLE_DIALER) == true
        stopped = false
        active.value = true
        scope.launch {
            try {
                callSosParents(parents.distinctBy { it.number }) { parent ->
                    val sync = SyncStore(context)
                    if (stopped || sync.phoneId != phoneId || CallManager.state.value.isNotEmpty()) {
                        return@callSosParents SosCallOutcome.STOPPED
                    }
                    if (sync.rules()?.sos?.parents?.none { it.number == parent.number } != false) {
                        return@callSosParents SosCallOutcome.UNANSWERED
                    }
                    if (placeCall(context, parent.number) != null) return@callSosParents SosCallOutcome.UNANSWERED
                    if (!canTrackCall) return@callSosParents SosCallOutcome.STOPPED
                    // The in-call service is the authoritative source for the ID and connection state.
                    val country = ContactPolicySources.get(context).rules().country
                    fun isParentCall(call: CallUi) =
                        !call.incoming && PhoneNumbers.normalize(call.number, country) == parent.number
                    val call = withTimeoutOrNull(5_000) {
                        CallManager.state.first { calls -> calls.any(::isParentCall) }.first(::isParentCall)
                    } ?: return@callSosParents SosCallOutcome.STOPPED
                    callId = call.id
                    if (stopped) {
                        CallManager.disconnect(call.id)
                        return@callSosParents SosCallOutcome.STOPPED
                    }
                    val answered = withTimeoutOrNull(30_000) {
                        CallManager.state.first { calls ->
                            val current = calls.find { it.id == call.id }
                            current == null || current.connectedAtMs != null || current.state == Call.STATE_ACTIVE
                        }.any { it.id == call.id }
                    }
                    if (answered == true) return@callSosParents SosCallOutcome.ANSWERED
                    if (answered == null) {
                        val latest = CallManager.state.value.find { it.id == call.id }
                        if (latest?.connectedAtMs != null || latest?.state == Call.STATE_ACTIVE) {
                            return@callSosParents SosCallOutcome.ANSWERED
                        }
                        CallManager.disconnect(call.id)
                        val ended = withTimeoutOrNull(5_000) {
                            CallManager.state.first { calls -> calls.none { it.id == call.id } }
                        }
                        if (ended == null) return@callSosParents SosCallOutcome.STOPPED
                    }
                    callId = null
                    SosCallOutcome.UNANSWERED
                }
            } finally {
                callId = null
                active.value = false
            }
        }
    }

    fun stop() {
        stopped = true
        callId?.let(CallManager::disconnect)
    }
}
