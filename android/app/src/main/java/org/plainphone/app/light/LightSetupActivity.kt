// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.plainphone.app.Lock
import org.plainphone.app.R
import org.plainphone.app.sync.Sync
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.ui.PairingActivity
import org.plainphone.app.ui.PlainphoneTheme

/**
 * Light-mode setup on a phone already in use: one protection per screen, in an order where each
 * step still works (the guard starts protecting Settings once setup is complete).
 */
class LightSetupActivity : ComponentActivity() {
    private var refresh by mutableIntStateOf(0)
    private var pendingLink by mutableStateOf<LightEnrollment.Link?>(null)
    private var batteryPromptOpened by mutableStateOf(false)

    private val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { refresh++ }
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.POST_NOTIFICATIONS] == true &&
            !LightSetup.isDone(this, LightSetup.Step.RUNNING)
        ) requestBatteryAccess()
        refresh++
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        receiveLink(intent)
        enableEdgeToEdge()
        setContent {
            PlainphoneTheme {
                @Suppress("UNUSED_EXPRESSION") refresh // recompose after every return from Settings
                val link = pendingLink
                val step = LightSetup.next(this)
                if (link != null) {
                    key(link) { ConfirmLink(link) }
                } else if (step == null) {
                    Done(onFinish = ::finishSetup)
                } else {
                    key(step) { StepScreen(step) }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        receiveLink(intent)
    }

    private fun receiveLink(intent: Intent) {
        pendingLink = LightEnrollment.parse(intent.data)?.takeIf { LightEnrollment.canImport(this) }
    }

    private fun dismissLink() {
        intent = Intent(this, LightSetupActivity::class.java)
        pendingLink = null
        refresh++
    }

    @Composable
    private fun ConfirmLink(link: LightEnrollment.Link) {
        var pin by remember { mutableStateOf("") }
        var failed by remember { mutableStateOf(false) }
        CalmScreen(
            eyebrow = null,
            title = stringResource(R.string.light_confirm_link_title),
            body = stringResource(R.string.light_confirm_link_body, link.server),
            primary = stringResource(R.string.light_confirm_link_action),
            onPrimary = {
                if (LightEnrollment.accept(this, link, pin)) dismissLink() else failed = true
            },
            secondary = stringResource(android.R.string.cancel),
            onSecondary = ::dismissLink,
        ) {
            PinField(
                value = pin,
                onChange = {
                    pin = it.filter { digit -> digit in '0'..'9' }.take(12)
                    failed = false
                },
                label = stringResource(R.string.light_pin_label),
            )
            if (failed) Text(
                stringResource(R.string.light_confirm_link_error),
                color = androidx.compose.material3.MaterialTheme.colorScheme.error,
            )
        }
    }

    override fun onResume() {
        super.onResume()
        refresh++
        if (LightSetup.next(this) == null && !LightRelease.isReleased(this)) LightSetup.markComplete(this)
        if (!Lock.isInMaintenanceWindow(this)) Lock.applyAsync(this, "light setup")
    }

    private fun finishSetup() {
        LightSetup.markComplete(this)
        Lock.applyAsync(this, "light setup done")
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    @Composable
    private fun StepScreen(step: LightSetup.Step) {
        val dashboard = LightSetup.hasDashboardPin(this) && step != LightSetup.Step.PIN
        val index = LightSetup.Step.entries.indexOf(step) - if (dashboard) 1 else 0
        val total = LightSetup.Step.entries.size - if (dashboard) 1 else 0
        if (step == LightSetup.Step.PAIR && dashboard && !LightSetup.isComplete(this)) {
            DashboardPairStep()
            return
        }
        if (step == LightSetup.Step.PIN) {
            PinStep(index, total)
            return
        }
        val batteryDone = step == LightSetup.Step.RUNNING && LightSetup.isDone(this, step)
        val batteryHelp = if (step == LightSetup.Step.RUNNING && LightSetup.notificationsAllowed(this) &&
            (batteryDone || batteryPromptOpened)
        ) LightSetup.batteryMaker() else null
        val backgroundLocationSettings = step == LightSetup.Step.LOCATION &&
            Build.VERSION.SDK_INT >= 30 && fineLocationAllowed()
        var guardHelp by rememberSaveable { mutableStateOf(false) }
        CalmScreen(
            eyebrow = stringResource(R.string.light_step_counter, index + 1, total),
            title = stringResource(step.title),
            body = stringResource(when {
                batteryHelp != null -> batteryHelp
                backgroundLocationSettings -> R.string.light_step_location_settings
                else -> step.body
            }),
            primary = stringResource(when {
                batteryHelp != null -> R.string.light_battery_settings
                backgroundLocationSettings -> R.string.light_app_info
                else -> step.action
            }),
            onPrimary = {
                if (batteryHelp != null) {
                    open(LightSetup.batteryMakerSettings(this))
                } else act(step)
            },
            secondary = when {
                batteryHelp != null && batteryDone -> stringResource(R.string.light_battery_continue)
                step.optional -> stringResource(if (dashboard) R.string.light_skip_options else R.string.light_skip)
                step == LightSetup.Step.GUARD && Build.VERSION.SDK_INT >= 33 ->
                    stringResource(if (guardHelp) R.string.light_app_info else R.string.light_guard_help)
                else -> null
            },
            onSecondary = {
                if (batteryHelp != null && batteryDone) {
                    LightSetup.finishBatteryMakerHelp(this)
                    refresh++
                } else if (step.optional) {
                    if (dashboard) LightSetup.skipOptions(this) else LightSetup.skip(this, step)
                    refresh++
                } else {
                    guardHelp = true
                    open(LightSetup.appDetails(this))
                }
            },
            progress = (index + 1f) / total,
        ) {
            PermissionIllustration(step)
            if (guardHelp) Text(stringResource(R.string.light_guard_help_body))
        }
    }

    @Composable
    private fun DashboardPairStep() {
        val store = SyncStore(this)
        val linkAvailable = store.enrollToken() != null
        val paired = store.isPaired
        val canConnect = linkAvailable || paired
        var attempt by remember { mutableIntStateOf(0) }
        var failed by remember { mutableStateOf(false) }
        LaunchedEffect(attempt) {
            if (!canConnect) return@LaunchedEffect
            try {
                val app = applicationContext
                if (!paired) {
                    withContext(Dispatchers.IO) { PairingActivity.controller(app).enroll() }
                    refresh++
                }
                if (store.isPaired) {
                    withContext(Dispatchers.IO) {
                        SyncScheduler.ensurePeriodic(app)
                        Sync.runner(app).run("initial light setup")
                    }
                }
                failed = store.isPaired && !LightSetup.hasDashboardRules(store)
                refresh++
            } catch (cancelled: CancellationException) {
                throw cancelled
            } catch (_: Exception) {
                failed = true
                refresh++
            }
        }
        CalmScreen(
            eyebrow = null,
            title = stringResource(R.string.light_step_pair_title),
            body = stringResource(when {
                failed -> R.string.light_link_network
                paired -> R.string.light_link_rules
                store.everPaired -> R.string.light_link_removed
                !linkAvailable -> R.string.light_link_expired
                else -> R.string.light_link_connecting
            }),
            primary = if (failed) stringResource(R.string.light_link_retry) else null,
            onPrimary = { failed = false; attempt++ },
            progress = 1f,
        ) {
            PermissionIllustration(LightSetup.Step.PAIR)
        }
    }

    private fun act(step: LightSetup.Step) {
        when (step) {
            // The PIN was set in step 1 and setup is only open until it is complete: no hour limit here.
            LightSetup.Step.PAIR -> startActivity(PairingActivity.intent(this, authorized = !LightSetup.isComplete(this)))
            LightSetup.Step.LOCATION -> askLocation()
            LightSetup.Step.RUNNING ->
                if (!LightSetup.notificationsAllowed(this)) { // only false on Android 13+
                    permissions.launch(arrayOf(Manifest.permission.POST_NOTIFICATIONS))
                } else {
                    requestBatteryAccess()
                }
            LightSetup.Step.USAGE ->
                open(LightSetup.intent(this, step), Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS))
            else -> open(LightSetup.intent(this, step))
        }
    }

    private fun requestBatteryAccess() {
        batteryPromptOpened = true
        open(LightSetup.intent(this, LightSetup.Step.RUNNING), LightSetup.appDetails(this))
    }

    private fun fineLocationAllowed() =
        checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED

    private fun askLocation() {
        when {
            !fineLocationAllowed() -> permissions.launch(arrayOf(
                Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION,
            ))
            Build.VERSION.SDK_INT >= 30 -> open(LightSetup.appDetails(this))
            else -> permissions.launch(arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION))
        }
    }

    private fun open(intent: Intent?, fallback: Intent = Intent(android.provider.Settings.ACTION_SETTINGS)) {
        if (intent == null) {
            refresh++
            return
        }
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            runCatching { launcher.launch(fallback) }
        } catch (_: SecurityException) {
            runCatching { launcher.launch(fallback) }
        }
    }

    @Composable
    private fun PinStep(index: Int, total: Int) {
        var first by remember { mutableStateOf("") }
        var second by remember { mutableStateOf("") }
        var error by remember { mutableStateOf<Int?>(null) }
        CalmScreen(
            eyebrow = stringResource(R.string.light_step_counter, index + 1, total),
            title = stringResource(R.string.light_step_pin_title),
            body = stringResource(R.string.light_step_pin_body),
            primary = stringResource(R.string.light_step_pin_action),
            onPrimary = {
                error = when {
                    first.length < 6 || !first.all(Char::isDigit) -> R.string.light_pin_too_short
                    first != second -> R.string.light_pin_mismatch
                    else -> null
                }
                if (error == null) {
                    LightSetup.savePin(this, first)
                    refresh++
                }
            },
            progress = (index + 1f) / total,
        ) {
            PinField(first, { first = it.filter(Char::isDigit).take(12) }, stringResource(R.string.light_pin_label))
            PinField(second, { second = it.filter(Char::isDigit).take(12) }, stringResource(R.string.light_pin_again))
            Text(stringResource(R.string.light_pin_dashboard_help))
            error?.let { Text(stringResource(it), color = androidx.compose.material3.MaterialTheme.colorScheme.error) }
        }
    }

    @Composable
    private fun PinField(value: String, onChange: (String) -> Unit, label: String) {
        OutlinedTextField(
            value = value,
            onValueChange = onChange,
            label = { Text(label) },
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            modifier = Modifier.fillMaxWidth(),
        )
    }

    @Composable
    private fun Done(onFinish: () -> Unit) {
        CalmScreen(
            eyebrow = null,
            title = stringResource(R.string.light_done_title),
            body = stringResource(R.string.light_done_body),
            primary = stringResource(R.string.light_done_action),
            onPrimary = onFinish,
            progress = 1f,
        )
    }

    companion object {
        fun intent(context: Context) = Intent(context, LightSetupActivity::class.java)
    }
}
