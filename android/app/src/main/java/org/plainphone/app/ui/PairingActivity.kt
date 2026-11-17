// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.zxing.BarcodeFormat
import com.google.zxing.EncodeHintType
import com.google.zxing.common.BitMatrix
import com.google.zxing.qrcode.QRCodeWriter
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.R
import org.plainphone.app.sync.EnrollResult
import org.plainphone.app.sync.PairPoll
import org.plainphone.app.sync.Pairing
import org.plainphone.app.sync.PairingController
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

/**
 * Shows the pairing code and QR code until a parent claims the phone in the dashboard.
 * Not exported. Without the maintenance PIN it only opens at setup time
 * (see [PairingController.allowedWithoutPin]).
 */
class PairingActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val authorized = intent.getBooleanExtra(EXTRA_AUTHORIZED, false)
        if (!authorized && !canPairWithoutPin(this)) {
            finish()
            return
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        enableEdgeToEdge()
        setContent { PlainphoneTheme { PairingScreen(onDone = ::finish) } }
    }

    companion object {
        /** Set only by the PIN-checked maintenance screen. */
        const val EXTRA_AUTHORIZED = "org.plainphone.app.PAIRING_AUTHORIZED"

        fun canPairWithoutPin(context: Context): Boolean {
            val store = SyncStore(context)
            return !store.isPaired && PairingController.allowedWithoutPin(
                store.everPaired, Lock.firstAppliedAtMs(context), System.currentTimeMillis(),
            )
        }

        fun controller(context: Context): PairingController {
            val app = context.applicationContext
            val version = app.packageManager.getPackageInfo(app.packageName, 0).versionName ?: "?"
            return PairingController(
                SyncStore(app),
                PlainphoneApi(ConfigStore(app).load().serverUrl),
                System::currentTimeMillis,
                mapOf(
                    "manufacturer" to Build.MANUFACTURER.take(200),
                    "model" to Build.MODEL.take(200),
                    "android" to Build.VERSION.RELEASE.take(200),
                    "appVersion" to version.take(200),
                ),
            )
        }

        fun intent(context: Context, authorized: Boolean) =
            Intent(context, PairingActivity::class.java).putExtra(EXTRA_AUTHORIZED, authorized)
    }
}

private sealed interface PairingUi {
    /** Pairing by itself with the token from the setup QR code. */
    data object Connecting : PairingUi
    data object Loading : PairingUi
    data class Showing(val pairing: Pairing) : PairingUi
    data object Paired : PairingUi
    data class Failed(val message: String) : PairingUi
}

@Composable
private fun PairingScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val controller = remember { PairingActivity.controller(context) }
    var ui by remember { mutableStateOf<PairingUi>(PairingUi.Loading) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(attempt) {
        // A QR code made in the dashboard carries a one-time token: pair without a code.
        if (attempt == 0 && withContext(Dispatchers.IO) { SyncStore(context).enrollToken() } != null) {
            ui = PairingUi.Connecting
            var tries = 0
            var keepTrying = true
            while (keepTrying && tries++ < ENROLL_TRIES) {
                when (withContext(Dispatchers.IO) { runCatching { controller.enroll() } }.getOrElse { EnrollRetry }) {
                    is EnrollResult.Paired -> {
                        SyncScheduler.ensurePeriodic(context)
                        SyncScheduler.now(context, "paired")
                        ui = PairingUi.Paired
                        delay(2_000)
                        onDone()
                        return@LaunchedEffect
                    }
                    EnrollRetry -> delay(POLL_MS) // no network yet: try again
                    else -> keepTrying = false // refused or gone: show a code below
                }
            }
            // Still offline after a while: show a code too; the background worker keeps trying the token.
            SyncScheduler.enrollIfNeeded(context)
        }
        ui = PairingUi.Loading
        val started = withContext(Dispatchers.IO) { runCatching { controller.start() } }
        ui = started.fold({ PairingUi.Showing(it) }, { PairingUi.Failed(it.message ?: it.javaClass.simpleName) })
        while (ui is PairingUi.Showing) {
            delay(POLL_MS)
            val polled = withContext(Dispatchers.IO) { runCatching { controller.poll() } }
            when (val r = polled.getOrNull()) {
                is PairPoll.Paired -> {
                    SyncScheduler.ensurePeriodic(context)
                    SyncScheduler.now(context, "paired")
                    ui = PairingUi.Paired
                }
                PairPoll.Expired -> {
                    // Codes live 15 minutes: show a fresh one.
                    val again = withContext(Dispatchers.IO) { runCatching { controller.start() } }
                    ui = again.fold({ PairingUi.Showing(it) }, { PairingUi.Failed(it.message ?: "") })
                }
                PairPoll.Waiting, null -> Unit // a network hiccup: keep showing the code and try again
            }
        }
        if (ui is PairingUi.Paired) {
            delay(2_000)
            onDone()
        }
    }

    Scaffold { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .verticalScroll(rememberScrollState())
                .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Text(stringResource(R.string.pairing_title), style = MaterialTheme.typography.headlineMedium)
            when (val state = ui) {
                PairingUi.Connecting -> Text(stringResource(R.string.pairing_connecting), textAlign = TextAlign.Center)
                PairingUi.Loading -> Text(stringResource(R.string.pairing_loading))
                is PairingUi.Showing -> {
                    Text(stringResource(R.string.pairing_instructions), textAlign = TextAlign.Center)
                    QrCode(state.pairing.qrUrl, Modifier.size(240.dp))
                    Text(
                        text = state.pairing.code,
                        fontFamily = FontFamily.Monospace,
                        fontWeight = FontWeight.SemiBold,
                        fontSize = 34.sp,
                        letterSpacing = 3.sp,
                        modifier = Modifier.semantics { contentDescription = state.pairing.code.toCharArray().joinToString(" ") },
                    )
                    Text(stringResource(R.string.pairing_waiting), color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                PairingUi.Paired -> Text(stringResource(R.string.pairing_done), style = MaterialTheme.typography.titleLarge)
                is PairingUi.Failed -> {
                    Text(stringResource(R.string.pairing_failed), textAlign = TextAlign.Center)
                    Button(onClick = { attempt++ }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(R.string.pairing_retry))
                    }
                }
            }
        }
    }
}

/** Dark modules on white with a quiet zone, also in dark mode, so every camera can read it. */
@Composable
private fun QrCode(text: String, modifier: Modifier) {
    val matrix = remember(text) { encodeQr(text) }
    val label = stringResource(R.string.pairing_qr_description)
    Box(modifier.background(Color.White).padding(12.dp).semantics { contentDescription = label }) {
        Canvas(Modifier.fillMaxSize()) {
            val cell = size.minDimension / matrix.width
            for (y in 0 until matrix.height) {
                for (x in 0 until matrix.width) {
                    if (matrix[x, y]) drawRect(Color.Black, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
                }
            }
        }
    }
}

private fun encodeQr(text: String): BitMatrix =
    QRCodeWriter().encode(text, BarcodeFormat.QR_CODE, 0, 0, mapOf(EncodeHintType.MARGIN to 0))

private const val POLL_MS = 3_000L
/** About a minute of trying the QR code's token before a code is shown as well. */
private const val ENROLL_TRIES = 20

/** Marker for "the network failed, try the token again". */
private data object EnrollRetry
