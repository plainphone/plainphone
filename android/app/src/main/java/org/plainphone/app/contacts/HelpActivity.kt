// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.contacts

import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.provider.Telephony
import android.telecom.TelecomManager
import android.webkit.WebResourceResponse
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import org.plainphone.app.R
import org.plainphone.app.ui.PhoneActivity
import org.plainphone.app.ui.PlainphoneTheme
import org.plainphone.app.ui.placeCall

class HelpActivity : ComponentActivity() {
    @OptIn(ExperimentalMaterial3Api::class)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val directory = ContactPolicySources.get(this).rules().help
        val links = HelpLinks(this)
        val initialWebsite = if (intent.action == Intent.ACTION_VIEW) {
            links.secureUrl(intent.dataString).also {
                if (it == null) {
                    finish()
                    return
                }
            }
        } else null
        setContent {
            PlainphoneTheme {
                var website by rememberSaveable { mutableStateOf(initialWebsite) }
                val back = { if (website == null) finish() else website = null }
                BackHandler(website != null, onBack = back)
                Scaffold(topBar = {
                    TopAppBar(title = { Text(stringResource(R.string.help_lines_title)) }, navigationIcon = {
                        TextButton(onClick = back) { Text(stringResource(R.string.help_lines_back)) }
                    })
                }) { padding ->
                    val url = website
                    if (url != null) {
                        val view = remember(url) { helpWebView(links, url) }
                        AndroidView(factory = { view }, modifier = Modifier.padding(padding).fillMaxSize())
                        DisposableEffect(view) {
                            onDispose { view.stopLoading(); view.destroy() }
                        }
                    } else {
                        LazyColumn(
                            modifier = Modifier.padding(padding).fillMaxSize(),
                            contentPadding = PaddingValues(20.dp),
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            item { Text(stringResource(if (directory.lines.isEmpty()) R.string.help_lines_empty else R.string.help_lines_intro)) }
                            items(directory.lines + directory.information, key = { it.name }) { line ->
                                Text(line.name, style = MaterialTheme.typography.titleMedium)
                                line.phone?.let { number ->
                                    TextButton(onClick = {
                                        callHelpLine(number)
                                    }) { Text("${stringResource(R.string.help_lines_call)} $number") }
                                }
                                line.sms?.let { number ->
                                    TextButton(onClick = {
                                        textHelpLine(number)
                                    }) { Text("${stringResource(R.string.help_lines_sms)} $number") }
                                }
                                line.website?.let { link ->
                                    TextButton(onClick = { website = links.secureUrl(link) }) { Text(stringResource(R.string.help_lines_web)) }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    private fun callHelpLine(number: String) {
        val dialer = getSystemService(TelecomManager::class.java)?.defaultDialerPackage
        if (checkSelfPermission(android.Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED &&
            dialer != null && dialer != packageName
        ) {
            launchHelpIntent(Intent(Intent.ACTION_DIAL, Uri.fromParts("tel", number, null)).setPackage(dialer), R.string.call_failed)
        } else {
            placeCall(this, number)?.let { Toast.makeText(this, it, Toast.LENGTH_LONG).show() }
        }
    }

    private fun textHelpLine(number: String) {
        val smsApp = Telephony.Sms.getDefaultSmsPackage(this)
        val intent = if (smsApp == null || smsApp == packageName) {
            PhoneActivity.conversationIntent(this, number)
        } else {
            Intent(Intent.ACTION_SENDTO, Uri.fromParts("smsto", number, null)).setPackage(smsApp)
        }
        launchHelpIntent(intent, R.string.message_send_failed)
    }

    private fun launchHelpIntent(intent: Intent, error: Int) {
        runCatching { startActivity(intent) }
            .onFailure { Toast.makeText(this, error, Toast.LENGTH_LONG).show() }
    }

    @SuppressLint("SetJavaScriptEnabled") // Official help sites use JavaScript for chat and accessibility.
    private fun helpWebView(links: HelpLinks, url: String): WebView = WebView(this).apply {
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.allowFileAccess = false
        settings.allowContentAccess = false
        webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean =
                !links.allowsNavigation(request.url)

            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? {
                // Navigation callbacks do not cover form submissions.
                if (request.isForMainFrame && !links.allowsNavigation(request.url)) {
                    return WebResourceResponse("text/plain", "UTF-8", 403, "Forbidden", emptyMap(), null)
                }
                return null
            }
        }
        loadUrl(url)
    }
}
