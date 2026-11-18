// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.ui

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import kotlinx.coroutines.launch
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.R
import org.plainphone.app.sync.EnrollResult
import org.plainphone.app.sync.HttpError
import org.plainphone.app.light.Mode
import org.plainphone.app.light.LightSetup
import org.plainphone.app.sync.PairPoll
import org.plainphone.app.sync.Pairing
import org.plainphone.app.sync.PairingController
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.ui.qr.QrCode
import org.plainphone.app.ui.qr.QrSegment

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
                PlainphoneApi(ConfigStore(app).load().serverUrl, app),
                mapOf(
                    "manufacturer" to Build.MANUFACTURER.take(200),
                    "model" to Build.MODEL.take(200),
                    "android" to Build.VERSION.RELEASE.take(200),
                    "appVersion" to version.take(200),
                ),
                mode = Mode.name(app),
                profile = LightSetup.profile(app).takeIf { Mode.isLight(app) },
                canRedeemEnrollment = {
                    Mode.isStrong(app) || LightSetup.linkReviewed(app)
                },
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
    data class Confirm(val details: PairPoll.Confirm, val enrollmentToken: String? = null, val matchesProfile: Boolean = true) : PairingUi
    data object Paired : PairingUi
    data class Failed(val message: String) : PairingUi
}

@Composable
private fun PairingScreen(onDone: () -> Unit) {
    val context = LocalContext.current
    val controller = remember { PairingActivity.controller(context) }
    val store = remember { SyncStore(context) }
    val api = remember { PlainphoneApi(ConfigStore(context).load().serverUrl, context.applicationContext) }
    var ui by remember { mutableStateOf<PairingUi>(PairingUi.Loading) }
    var attempt by remember { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    var deciding by remember { mutableStateOf(false) }
    var decisionFailed by remember { mutableStateOf(false) }
    var confirmationStarted by rememberSaveable { mutableStateOf(false) }
    fun decide(confirm: Boolean) {
        if (deciding) return
        val enrollmentToken = (ui as? PairingUi.Confirm)?.enrollmentToken
        deciding = true
        decisionFailed = false
        if (confirm) confirmationStarted = true
        scope.launch {
            try {
                val result = withContext(Dispatchers.IO) {
                    if (enrollmentToken == null) controller.decide(confirm)
                    else if (confirm) {
                        synchronized(PairingController.enrollmentLock) {
                            if (store.enrollToken() != enrollmentToken || !store.confirmEnrollment()) {
                                PairPoll.Expired
                            } else when (val enrolled = controller.enroll()) {
                                is EnrollResult.Paired -> PairPoll.Paired(enrolled.phoneId, enrolled.deviceToken)
                                EnrollResult.Rejected -> PairPoll.Expired
                                null -> if (store.isPaired) PairPoll.Paired(checkNotNull(store.phoneId), checkNotNull(store.deviceToken()))
                                    else PairPoll.Expired
                            }
                        }
                    } else {
                        api.cancelEnrollment(enrollmentToken, Mode.name(context))
                        store.saveEnrollToken(null)
                        PairPoll.Expired
                    }
                }
                when (result) {
                    is PairPoll.Paired -> {
                        SyncScheduler.ensurePeriodic(context)
                        SyncScheduler.now(context, "paired")
                        ui = PairingUi.Paired
                        onDone()
                    }
                    PairPoll.Expired -> if (confirm) {
                        confirmationStarted = false
                        attempt++
                    } else onDone()
                    else -> decisionFailed = true
                }
            } catch (_: java.io.IOException) {
                if (confirm && enrollmentToken != null) SyncScheduler.enrollIfNeeded(context)
                decisionFailed = true
            } finally {
                deciding = false
            }
        }
    }
    BackHandler(ui is PairingUi.Confirm) {
        if (!confirmationStarted) decide(false)
    }

    LaunchedEffect(attempt) {
        val enrollmentToken = withContext(Dispatchers.IO) {
            store.enrollToken()?.takeIf { !Mode.isLight(context) || LightSetup.linkReviewed(context) }
        }
        if (enrollmentToken != null && !store.isPaired) {
            ui = PairingUi.Connecting
            try {
                if (Mode.isStrong(context) || store.enrollmentConfirmed) {
                    withContext(Dispatchers.IO) { controller.enroll() }
                    if (store.isPaired) {
                        SyncScheduler.ensurePeriodic(context)
                        SyncScheduler.now(context, "paired")
                        onDone()
                        return@LaunchedEffect
                    }
                } else {
                    val (account, profile) = withContext(Dispatchers.IO) { api.reviewEnrollment(enrollmentToken, Mode.name(context)) }
                    val selectedProfile = LightSetup.profile(context)
                    ui = PairingUi.Confirm(
                        PairPoll.Confirm(account.maskedEmail, account.householdName),
                        enrollmentToken,
                        selectedProfile == null || selectedProfile == profile,
                    )
                    return@LaunchedEffect
                }
            } catch (e: HttpError) {
                if (e.status != 404 && e.status != 410) {
                    ui = PairingUi.Failed(e.message.orEmpty())
                    return@LaunchedEffect
                }
                withContext(Dispatchers.IO) { store.saveEnrollToken(null) }
            } catch (e: java.io.IOException) {
                ui = PairingUi.Failed(e.message.orEmpty())
                return@LaunchedEffect
            }
        }
        if (store.isPaired) {
            onDone()
            return@LaunchedEffect
        }
        ui = PairingUi.Loading
        val started = withContext(Dispatchers.IO) { runCatching { controller.start() } }
        ui = started.fold({ PairingUi.Showing(it) }, { PairingUi.Failed(it.message ?: it.javaClass.simpleName) })
        while (ui is PairingUi.Showing) {
            delay(POLL_MS)
            // EnrollWorker may pair the phone with the QR code's token meanwhile: then stop showing
            // a code, so nobody else can claim it.
            if (withContext(Dispatchers.IO) { SyncStore(context).isPaired }) {
                ui = PairingUi.Paired
                break
            }
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
                is PairPoll.Confirm -> ui = PairingUi.Confirm(r)
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
            Text(stringResource(R.string.setup_pair_self_title), style = MaterialTheme.typography.headlineMedium)
            when (val state = ui) {
                PairingUi.Connecting -> Text(stringResource(R.string.pairing_connecting), textAlign = TextAlign.Center)
                PairingUi.Loading -> Text(stringResource(R.string.pairing_loading))
                is PairingUi.Showing -> {
                    Text(stringResource(if (Mode.isLight(context) && LightSetup.profile(context) == "self") R.string.setup_pair_self else R.string.pairing_instructions), textAlign = TextAlign.Center)
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
                is PairingUi.Confirm -> {
                    Text(stringResource(R.string.setup_pair_account, state.details.maskedEmail))
                    state.details.householdName?.let { Text(stringResource(R.string.setup_pair_household, it)) }
                    if (decisionFailed) Text(stringResource(R.string.pairing_failed), color = MaterialTheme.colorScheme.error)
                    if (state.matchesProfile) {
                        Button(onClick = { decide(true) }, enabled = !deciding, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.setup_connect))
                        }
                    } else {
                        Text(stringResource(R.string.setup_profile_mismatch))
                    }
                    if (!confirmationStarted) {
                        androidx.compose.material3.OutlinedButton(
                            onClick = { decide(false) }, enabled = !deciding, modifier = Modifier.fillMaxWidth(),
                        ) { Text(stringResource(R.string.setup_not_you)) }
                    }
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
    val matrix = remember(text) { encodePairingQr(text) }
    val label = stringResource(R.string.pairing_qr_description)
    Box(modifier.background(Color.White).padding(12.dp).semantics { contentDescription = label }) {
        Canvas(Modifier.fillMaxSize()) {
            val cell = size.minDimension / matrix.size
            for (y in 0 until matrix.size) {
                for (x in 0 until matrix.size) {
                    if (matrix.getModule(x, y)) drawRect(Color.Black, Offset(x * cell, y * cell), Size(cell + 0.5f, cell + 0.5f))
                }
            }
        }
    }
}

internal fun encodePairingQr(text: String): QrCode =
    QrCode.encodeSegments(QrSegment.makeSegments(text), QrCode.Ecc.LOW, 1, 40, -1, false)

private const val POLL_MS = 3_000L
