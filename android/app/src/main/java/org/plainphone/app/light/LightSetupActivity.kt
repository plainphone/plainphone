// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import org.plainphone.app.Lock
import org.plainphone.app.R
import org.plainphone.app.ui.PairingActivity
import org.plainphone.app.ui.PlainphoneTheme

/**
 * Light-mode setup on a phone already in use: one protection per screen, in an order where each
 * step still works (the guard comes last, because it protects the very screens used before it).
 */
class LightSetupActivity : ComponentActivity() {
    private var refresh by mutableIntStateOf(0)

    private val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { refresh++ }
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { refresh++ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PlainphoneTheme {
                @Suppress("UNUSED_EXPRESSION") refresh // recompose after every return from Settings
                val step = LightSetup.next(this)
                if (step == null) {
                    Done(onFinish = ::finishSetup)
                } else {
                    StepScreen(step)
                }
            }
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
        val index = LightSetup.Step.entries.indexOf(step)
        val total = LightSetup.Step.entries.size
        if (step == LightSetup.Step.PIN) {
            PinStep(index, total)
            return
        }
        CalmScreen(
            eyebrow = stringResource(R.string.light_step_counter, index + 1, total),
            title = stringResource(step.title),
            body = stringResource(step.body),
            primary = stringResource(step.action),
            onPrimary = { act(step) },
            secondary = if (step.optional) stringResource(R.string.light_skip) else null,
            onSecondary = { LightSetup.skip(this, step); refresh++ },
            progress = (index + 1f) / total,
        )
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
                    open(LightSetup.intent(this, step))
                }
            else -> open(LightSetup.intent(this, step))
        }
    }

    /** Android asks for background location separately, after the foreground one. */
    private fun askLocation() {
        val fine = checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == android.content.pm.PackageManager.PERMISSION_GRANTED
        permissions.launch(
            if (!fine) arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
            else arrayOf(Manifest.permission.ACCESS_BACKGROUND_LOCATION),
        )
    }

    private fun open(intent: Intent?) {
        if (intent == null) {
            refresh++
            return
        }
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            // Some makers lack a screen (e.g. usage access); the general settings are the next best place.
            runCatching { launcher.launch(Intent(android.provider.Settings.ACTION_SETTINGS)) }
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
