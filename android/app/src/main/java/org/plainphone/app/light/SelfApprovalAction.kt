// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.os.SystemClock
import android.content.Intent
import android.net.Uri
import android.view.WindowManager
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.window.DialogWindowProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.plainphone.app.ConfigStore
import org.plainphone.app.R
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.ui.QrCode

@Composable
internal fun SelfApprovalAction() {
    val context = LocalContext.current.applicationContext
    if (LightSetup.profile(context) != "self") return
    val token = SyncStore(context).deviceToken() ?: return
    var template by remember { mutableStateOf(false) }
    var invite by remember { mutableStateOf(false) }
    var open by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf(false) }
    var requests by remember { mutableStateOf<List<PlainphoneApi.ApprovalRequest>?>(null) }
    var selected by remember { mutableStateOf<String?>(null) }
    val language = LocalConfiguration.current.locales[0].language
    var qrSummary by remember { mutableStateOf<String?>(null) }
    var qr by remember { mutableStateOf<String?>(null) }
    val close = { open = false; template = false; invite = false; error = false; requests = null; selected = null; qr = null; qrSummary = null }
    TextButton(onClick = { open = true }) { Text(stringResource(R.string.self_approval_title)) }
    TextButton(onClick = { invite = true; open = true }) { Text(stringResource(R.string.setup_key_qr)) }
    TextButton(onClick = { template = true; open = true }) { Text(stringResource(R.string.self_template_share)) }
    ScanPlainphoneCode()
    if (!open) return
    val api = remember { PlainphoneApi(ConfigStore(context).load().serverUrl, context) }
    LaunchedEffect(selected, invite, template, language) {
        val id = selected
        try {
            if (template) {
                qr = withContext(Dispatchers.IO) { api.selfTemplateUrl(token) }
                delay(15 * 60_000L)
                close()
            } else if (invite) {
                qr = withContext(Dispatchers.IO) { api.trustedInviteUrl(token) }
                if (qr == null) requests = emptyList()
                else {
                    delay(15 * 60_000L)
                    qr = null
                    requests = emptyList()
                }
            } else if (id == null) requests = withContext(Dispatchers.IO) { api.approvalRequests(token, language) }
            else {
                val started = SystemClock.elapsedRealtime()
                val approval = withContext(Dispatchers.IO) { api.approvalQr(token, id, language) }
                qrSummary = approval.summary
                qr = approval.url
                delay((120_000 - (SystemClock.elapsedRealtime() - started)).coerceAtLeast(0))
                qr = null
                qrSummary = null
                selected = null
            }
        } catch (_: IOException) {
            error = true
        }
    }
    AlertDialog(
        onDismissRequest = close,
        title = { Text(stringResource(when { template -> R.string.self_template_share; invite -> R.string.setup_key_qr; else -> R.string.self_approval_title })) },
        text = {
            val dialog = LocalView.current.parent as? DialogWindowProvider
            DisposableEffect(dialog) {
                if (!invite && !template) dialog?.window?.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
                onDispose { dialog?.window?.clearFlags(WindowManager.LayoutParams.FLAG_SECURE) }
            }
            Column(Modifier.heightIn(max = 320.dp).verticalScroll(rememberScrollState())) {
                val url = qr
                val rows = requests
                when {
                    error -> Text(stringResource(R.string.pairing_failed))
                    url != null -> {
                        Text(stringResource(when { template -> R.string.self_template_help; invite -> R.string.self_invite_scan; else -> R.string.self_approval_scan }))
                        qrSummary?.let { Text(it) }
                        QrCode(url, Modifier.size(200.dp))
                    }
                    rows == null || selected != null -> Text(stringResource(R.string.self_approval_loading))
                    rows.isEmpty() -> Text(stringResource(if (invite) R.string.self_invite_unavailable else R.string.self_approval_empty))
                    else -> rows.forEach { request ->
                        TextButton(onClick = { selected = request.id }) { Text(request.summary) }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(onClick = close) { Text(stringResource(android.R.string.cancel)) }
        },
    )
}


@Composable
internal fun ScanPlainphoneCode(label: Int = R.string.self_scan_code, setup: LightEnrollment.Link? = null) {
    val context = LocalContext.current
    TextButton(onClick = {
        val base = ConfigStore(context).load().serverUrl.trimEnd('/')
        val url = if (setup == null) Uri.parse("$base/approvals?scan=1") else {
            val fragment = "token=${Uri.encode(setup.token)}&package=${Uri.encode(context.packageName)}"
            Uri.parse("${setup.server}/install-phone?scan=template").buildUpon().encodedFragment(fragment).build()
        }
        runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, url)) }
    }) { Text(stringResource(label)) }
}
