// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.requests

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.Compat
import org.plainphone.app.ConfigStore
import org.plainphone.app.R
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.ui.PlainphoneTheme

/**
 * What the child has asked for, and what became of it. While a request waits, a parent standing
 * next to the child can approve it here with the parent PIN ([PinApproval]).
 */
class RequestsActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        // The PIN is typed on this screen: no screenshots, no recents preview.
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        val app = applicationContext
        val store = SyncStore(app)
        val token = store.deviceToken()
        val api = PlainphoneApi(ConfigStore(app).load().serverUrl, app)
        val approval = PinApproval(
            check = { ParentPinCheck.check(app, it) },
            save = store::queuePhoneApproval,
            report = { id -> api.reportApprovedOnPhone(token ?: throw IOException("not paired"), id) },
            reported = store::phoneApprovalReported,
        )
        setContent {
            var requests by remember { mutableStateOf<List<PhoneRequest>?>(null) }
            var failed by remember { mutableStateOf(false) }
            var attempt by remember { mutableStateOf(0) }
            var pin by remember { mutableStateOf<PinDialog?>(null) }
            var notice by remember { mutableStateOf<String?>(null) }
            var saved by remember { mutableStateOf(store.pendingPhoneApprovals()) }
            val scope = rememberCoroutineScope()
            val pinApproval = store.rules()?.pinApproval == true

            LaunchedEffect(attempt) {
                failed = false
                try {
                    val list = withContext(Dispatchers.IO) { api.phoneRequests(token ?: throw IOException("not paired")) }
                    requests = list
                    store.openRequests = list.count { it.pending && it.id !in store.pendingPhoneApprovals() }
                } catch (_: IOException) {
                    failed = true
                }
            }

            PlainphoneTheme {
                RequestsScreen(
                    RequestsUi(
                        rows = requestRows(requests.orEmpty(), saved) { label(app, it) },
                        loading = requests == null && !failed,
                        failed = failed,
                        pinApproval = pinApproval,
                        pin = pin,
                        notice = notice,
                    ),
                    RequestsActions(
                        back = ::finish,
                        retry = { attempt++ },
                        parentIsHere = { id -> notice = null; pin = PinDialog(id) },
                        cancelPin = { pin = null },
                        submitPin = submit@{ entered ->
                            val id = pin?.requestId ?: return@submit
                            pin = PinDialog(id, busy = true)
                            scope.launch {
                                val outcome = withContext(Dispatchers.IO) { approval.approve(id, entered) }
                                saved = store.pendingPhoneApprovals()
                                when (outcome) {
                                    PinApproval.Outcome.Wrong -> pin = PinDialog(id, getString(R.string.requests_pin_wrong))
                                    PinApproval.Outcome.NoPin -> pin = PinDialog(id, getString(R.string.requests_pin_none))
                                    is PinApproval.Outcome.Wait ->
                                        pin = PinDialog(id, resources.getQuantityString(R.plurals.requests_pin_wait, outcome.seconds, outcome.seconds))
                                    PinApproval.Outcome.Saved -> {
                                        pin = null
                                        notice = getString(R.string.requests_status_approved_phone_sending)
                                    }
                                    is PinApproval.Outcome.Reported -> {
                                        pin = null
                                        val request = outcome.request
                                        notice = getString(
                                            when {
                                                // The server did not take it: never say "approved" for that.
                                                request == null -> R.string.requests_approve_failed
                                                !request.approvedOnPhone -> R.string.requests_already_answered
                                                request.kind == PhoneRequest.Kind.MORE_TIME -> R.string.requests_approved_now_more_time
                                                else -> R.string.requests_approved_now
                                            },
                                        )
                                        attempt++
                                    }
                                }
                            }
                        },
                    ),
                )
            }
        }
    }

    /** The app's name on this phone, or its package name when the phone does not know it. */
    private fun label(context: Context, r: PhoneRequest): String = when (r.kind) {
        PhoneRequest.Kind.APP -> r.packageName?.let { pkg ->
            runCatching {
                val pm = context.packageManager
                pm.getApplicationLabel(Compat.applicationInfo(pm, pkg, PackageManager.MATCH_UNINSTALLED_PACKAGES)).toString()
            }.getOrNull() ?: pkg
        } ?: ""
        PhoneRequest.Kind.MORE_TIME ->
            r.packageName?.let { pkg -> label(context, r.copy(kind = PhoneRequest.Kind.APP, packageName = pkg)) }
                ?: context.getString(R.string.requests_more_time_total)
        PhoneRequest.Kind.CONTACT -> listOfNotNull(r.name, r.number?.let { if (r.name == null) it else "($it)" }).joinToString(" ")
    }

    companion object {
        fun intent(context: Context): Intent = Intent(context, RequestsActivity::class.java)
    }
}
