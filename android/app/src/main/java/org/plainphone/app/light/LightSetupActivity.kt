// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.Manifest
import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.compose.material3.OutlinedButton
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.MainActivity
import org.plainphone.app.R
import org.plainphone.app.sync.PairingController
import org.plainphone.app.sync.PlainphoneApi
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

    private var requestedStep: LightSetup.Step? = null
    private var restrictedStep by mutableStateOf<LightSetup.Step?>(null)
    private val launcher = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) {
        permissionStepReturned()
    }

    private fun permissionStepReturned() {
        LightSetup.finishVpnSetup()
        val step = requestedStep
        requestedStep = null
        if (step != null && needsRestrictedSettingsHelp(Build.VERSION.SDK_INT, step, LightSetup.isDone(this, step))) {
            restrictedStep = step
        }
        refresh++
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putString("requestedStep", requestedStep?.name)
        outState.putString("restrictedStep", restrictedStep?.name)
        super.onSaveInstanceState(outState)
    }
    private val permissions = registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.POST_NOTIFICATIONS] == true &&
            !LightSetup.isDone(this, LightSetup.Step.RUNNING)
        ) requestBatteryAccess()
        refresh++
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        if (Mode.isStrong(this)) {
            startActivity(Intent(this, MainActivity::class.java))
            finish()
            return
        }
        requestedStep = savedInstanceState?.getString("requestedStep")?.let(LightSetup.Step::valueOf)
        restrictedStep = savedInstanceState?.getString("restrictedStep")?.let(LightSetup.Step::valueOf)
        receiveLink(intent)
        val store = SyncStore(this)
        if (pendingLink == null && LightEnrollment.canImport(this, store) && !LightSetup.linkReviewed(this)) {
            pendingLink = store.enrollToken()?.let { LightEnrollment.Link(it, ConfigStore(this).load().serverUrl) }
        }
        enableEdgeToEdge()
        setContent {
            PlainphoneTheme {
                @Suppress("UNUSED_EXPRESSION") refresh // recompose after every return from Settings
                val link = pendingLink
                val step = LightSetup.next(this)
                if (LightSetup.profile(this) == null && !LightSetup.isComplete(this)) {
                    AudienceScreen()
                } else if (link != null) {
                    key(link) { ConfirmLink(link) }
                } else if (step == null) {
                    LaunchedEffect(Unit) {
                        if (!LightRelease.isReleased(this@LightSetupActivity) && !LightSetup.isComplete(this@LightSetupActivity)) {
                            LightSetup.markComplete(this@LightSetupActivity)
                            refresh++
                        }
                    }
                    Done(onFinish = ::finishSetup)
                } else {
                    key(step) { StepScreen(step) }
                }
            }
        }
    }

    @Composable
    private fun AudienceScreen() {
        var audience by rememberSaveable { mutableStateOf<SetupAudience?>(null) }
        var otherVpn by rememberSaveable { mutableStateOf<Boolean?>(null) }
        var undoMinutes by rememberSaveable { mutableStateOf<Int?>(null) }
        var keyChosen by rememberSaveable { mutableStateOf(false) }
        var waitHours by rememberSaveable { mutableStateOf<Int?>(null) }
        var trusted by rememberSaveable { mutableStateOf(false) }
        var inviteByQr by rememberSaveable { mutableStateOf(false) }
        var email by rememberSaveable { mutableStateOf("") }
        val back = {
            audience = null
            otherVpn = null
            undoMinutes = null
            keyChosen = false
            waitHours = null
            trusted = false
            inviteByQr = false
            email = ""
        }
        BackHandler(audience != null, onBack = back)
        when (audience) {
            null -> CalmScreen(
                eyebrow = null,
                title = stringResource(R.string.setup_audience),
                body = null,
                primary = null,
                onPrimary = {},
            ) {
                for ((choice, label) in listOf(
                    SetupAudience.CHILD to R.string.setup_child,
                    SetupAudience.PARENT to R.string.setup_parent,
                    SetupAudience.MYSELF to R.string.setup_myself,
                )) {
                    OutlinedButton(onClick = { audience = choice }, modifier = Modifier.fillMaxWidth()) {
                        Text(stringResource(label))
                    }
                }
            }
            SetupAudience.PARENT -> CalmScreen(
                eyebrow = null,
                title = stringResource(R.string.setup_parent),
                body = stringResource(R.string.setup_parent_body),
                primary = stringResource(R.string.setup_dashboard),
                onPrimary = { runCatching { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://app.plainphone.org"))) } },
                secondary = stringResource(R.string.setup_back),
                onSecondary = back,
            ) {
                OutlinedButton(onClick = { audience = SetupAudience.MYSELF }, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.setup_parent_try_self))
                }
                ScanPlainphoneCode()
            }
            else -> {
                val choice = checkNotNull(audience)
                if (choice == SetupAudience.MYSELF && Mode.isLight(this) && otherVpn == null) {
                    CalmScreen(
                        eyebrow = null,
                        title = stringResource(R.string.light_other_vpn),
                        body = stringResource(R.string.light_other_vpn_tip),
                        primary = stringResource(R.string.light_other_vpn_yes),
                        onPrimary = { otherVpn = true },
                        secondary = stringResource(R.string.light_other_vpn_no),
                        onSecondary = { otherVpn = false },
                    )
                    return
                }
                if (choice == SetupAudience.MYSELF && Mode.isLight(this) && undoMinutes == null) {
                    CalmScreen(
                        eyebrow = null,
                        title = stringResource(R.string.setup_undo_choice_title),
                        body = stringResource(R.string.setup_undo_choice_body),
                        primary = null,
                        onPrimary = {},
                        secondary = stringResource(R.string.setup_back),
                        onSecondary = back,
                    ) {
                        ScanPlainphoneCode(R.string.self_template_import, pendingLink)
                        for (minutes in SETUP_UNDO_CHOICES) {
                            OutlinedButton(
                                onClick = { undoMinutes = minutes },
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(when (minutes) {
                                    0 -> stringResource(R.string.setup_undo_choice_off)
                                    10 -> stringResource(R.string.setup_undo_choice_default)
                                    else -> stringResource(R.string.setup_undo_choice_minutes, minutes)
                                })
                            }
                        }
                    }
                    return
                }
                if (choice == SetupAudience.MYSELF && !keyChosen) {
                    val ready = if (trusted) inviteByQr || android.util.Patterns.EMAIL_ADDRESS.matcher(email.trim()).matches() else waitHours != null
                    CalmScreen(
                        eyebrow = null,
                        title = stringResource(R.string.setup_key_title),
                        body = stringResource(R.string.setup_key_body) + "\n" +
                            stringResource(R.string.setup_key_overrides_dashboard),
                        primary = if (ready) stringResource(R.string.setup_continue) else null,
                        onPrimary = { keyChosen = true },
                        secondary = stringResource(R.string.setup_back),
                        onSecondary = back,
                    ) {
                        OutlinedButton(onClick = { trusted = false; waitHours = null }, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.setup_key_wait))
                        }
                        OutlinedButton(onClick = { trusted = true; waitHours = null }, modifier = Modifier.fillMaxWidth()) {
                            Text(stringResource(R.string.setup_key_trusted))
                        }
                        if (trusted) {
                            OutlinedButton(onClick = { inviteByQr = !inviteByQr }, modifier = Modifier.fillMaxWidth()) {
                                Text(stringResource(if (inviteByQr) R.string.setup_key_email else R.string.setup_key_qr))
                            }
                            if (inviteByQr) Text(stringResource(R.string.setup_key_qr_help))
                            else OutlinedTextField(
                                value = email,
                                onValueChange = { email = it },
                                label = { Text(stringResource(R.string.setup_key_email)) },
                                singleLine = true,
                                modifier = Modifier.fillMaxWidth(),
                            )
                            Text(stringResource(R.string.setup_key_trusted_preview))
                        } else {
                            for (hours in listOf(1, 6, 12, 24, 48, 72)) {
                                OutlinedButton(onClick = { waitHours = hours }, modifier = Modifier.fillMaxWidth()) {
                                    Text(stringResource(R.string.setup_key_hours, hours))
                                }
                            }
                            waitHours?.let { Text(stringResource(R.string.setup_key_wait_preview, it)) }
                        }
                    }
                    return
                }
                CalmScreen(
                    eyebrow = null,
                    title = stringResource(if (choice == SetupAudience.MYSELF) R.string.setup_confirm_self else R.string.setup_confirm_child),
                    body = stringResource(if (choice == SetupAudience.MYSELF) R.string.setup_confirm_self_body else R.string.setup_confirm_child_body),
                    primary = stringResource(R.string.setup_continue),
                    onPrimary = {
                        LightSetup.saveInitialFilterMethod(this, otherVpn)
                        undoMinutes?.let { LightSetup.saveUndoMinutes(this, it) }
                        if (choice == SetupAudience.MYSELF) {
                            LightSetup.saveSelfKey(this, waitHours, if (trusted) email.trim() else "", trusted && inviteByQr)
                        }
                        LightSetup.saveProfile(this, checkNotNull(choice.profile))
                        refresh++
                    },
                    secondary = stringResource(R.string.setup_back),
                    onSecondary = back,
                )
            }
        }
    }

    private fun changeAudience() {
        LightSetup.clearProfile(this)
        refresh++
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
        var repeatedPin by remember { mutableStateOf("") }
        var error by remember { mutableStateOf<Int?>(null) }
        var saving by remember { mutableStateOf(false) }
        val scope = rememberCoroutineScope()
        val api = remember(link) { PlainphoneApi(link.server, applicationContext) }
        var review by remember(link) { mutableStateOf<Pair<PlainphoneApi.PollAccount, String>?>(null) }
        var retry by remember(link) { mutableIntStateOf(0) }
        LaunchedEffect(link, retry) {
            try {
                review = withContext(Dispatchers.IO) { api.reviewEnrollment(link.token, "light") }
            } catch (_: java.io.IOException) {
                error = R.string.pairing_failed
            }
        }
        val account = review?.first
        val matches = review?.second == LightSetup.profile(this)
        val keepsSavedPin = LightSetup.hasDashboardPin(this) && !LightSetup.linkReviewed(this) &&
            SyncStore(this).enrollToken() == link.token && ConfigStore(this).load().serverUrl == link.server
        CalmScreen(
            eyebrow = null,
            title = stringResource(R.string.light_confirm_link_title),
            body = when {
                account == null -> stringResource(R.string.pairing_loading)
                !matches -> stringResource(R.string.setup_profile_mismatch)
                keepsSavedPin -> stringResource(R.string.setup_saved_link_body)
                else -> stringResource(if (LightSetup.profile(this) == "self") R.string.setup_link_self else R.string.light_confirm_link_body, link.server)
            },
            primary = when {
                saving -> null
                account == null && error != null -> stringResource(R.string.pairing_retry)
                matches -> stringResource(R.string.light_confirm_link_action)
                else -> null
            },
            onPrimary = primary@{
                if (account == null) {
                    error = null
                    retry++
                    return@primary
                }
                if (!matches) return@primary
                if (keepsSavedPin) {
                    LightSetup.markLinkReviewed(this)
                    dismissLink()
                    return@primary
                }
                error = when {
                    pin.length < 6 -> R.string.light_pin_too_short
                    pin != repeatedPin -> R.string.light_pin_mismatch
                    else -> null
                }
                if (error == null) {
                    val chosenPin = pin
                    val confirmation = repeatedPin
                    saving = true
                    scope.launch {
                        val accepted = withContext(Dispatchers.IO) {
                            LightEnrollment.accept(applicationContext, link, chosenPin, confirmation)
                        }
                        saving = false
                        if (pendingLink === link) {
                            if (accepted) dismissLink() else error = R.string.light_confirm_link_error
                        }
                    }
                }
            },
            secondary = if (saving) null else stringResource(R.string.setup_not_you),
            onSecondary = {
                saving = true
                scope.launch {
                    try {
                        withContext(Dispatchers.IO) {
                            api.cancelEnrollment(link.token, "light")
                            val store = SyncStore(applicationContext)
                            if (store.enrollToken() == link.token) store.saveEnrollToken(null)
                        }
                        dismissLink()
                    } catch (_: java.io.IOException) {
                        error = R.string.pairing_failed
                    } finally {
                        saving = false
                    }
                }
            },
        ) {
            account?.let {
                Text(stringResource(R.string.setup_pair_account, it.maskedEmail))
                it.householdName?.let { name -> Text(stringResource(R.string.setup_pair_household, name)) }
            }
            if (account != null && !matches && !saving) {
                OutlinedButton(onClick = ::changeAudience, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.setup_back))
                }
            }
            if (matches && account != null && !keepsSavedPin) {
                PinField(pin, {
                    pin = it.filter { digit -> digit in '0'..'9' }.take(12)
                    error = null
                }, stringResource(R.string.light_pin_label))
                PinField(repeatedPin, {
                    repeatedPin = it.filter { digit -> digit in '0'..'9' }.take(12)
                    error = null
                }, stringResource(R.string.light_pin_again))
            }
            error?.let { Text(stringResource(it), color = androidx.compose.material3.MaterialTheme.colorScheme.error) }
        }
    }

    override fun onResume() {
        super.onResume()
        if (isFinishing) return
        refresh++
        if (LightSetup.profile(this) == null && !LightSetup.isComplete(this)) return
        if (LightSetup.next(this) == null && !LightRelease.isReleased(this)) LightSetup.markComplete(this)
        if (SyncStore(this).isPaired && !Lock.isInMaintenanceWindow(this)) Lock.applyAsync(this, "light setup")
    }

    private fun finishSetup() {
        LightSetup.markComplete(this)
        Lock.applyAsync(this, "light setup done")
        startActivity(Intent(this, HomeActivity::class.java))
        finish()
    }

    @Composable
    private fun StepScreen(step: LightSetup.Step) {
        if (restrictedStep == step) {
            CalmScreen(
                eyebrow = null,
                title = stringResource(step.title),
                body = stringResource(R.string.setup_restricted_body),
                primary = stringResource(R.string.light_app_info),
                onPrimary = { open(LightSetup.appDetails(this)) },
                secondary = stringResource(R.string.pairing_retry),
                onSecondary = { restrictedStep = null; act(step) },
            )
            return
        }
        val dashboard = LightSetup.hasDashboardPin(this) && step != LightSetup.Step.PIN
        val index = LightSetup.Step.entries.indexOf(step) - if (dashboard) 1 else 0
        val total = LightSetup.Step.entries.size - if (dashboard) 1 else 0
        if (step == LightSetup.Step.PAIR && dashboard && !LightSetup.isComplete(this)) {
            DashboardPairStep(index, total)
            return
        }
        if (step == LightSetup.Step.PIN) {
            PinStep(index, total)
            return
        }
        if (step == LightSetup.Step.FILTER && LightFilter.method(this) == FilterMethod.PRIVATE_DNS) {
            PrivateDnsStep(index, total)
            return
        }
        if (step == LightSetup.Step.FILTER && LightFilter.strictDnsConfigured(this)) {
            CalmScreen(
                eyebrow = stringResource(R.string.light_step_counter, index + 1, total),
                title = stringResource(R.string.light_private_dns_title),
                body = stringResource(R.string.light_vpn_restore_dns),
                primary = stringResource(R.string.light_private_dns_settings),
                onPrimary = { open(Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS)) },
                progress = (index + 1f) / total,
            )
            return
        }
        val batteryDone = step == LightSetup.Step.RUNNING && LightSetup.isDone(this, step)
        val batteryHelp = if (step == LightSetup.Step.RUNNING && LightSetup.notificationsAllowed(this) &&
            (batteryDone || batteryPromptOpened)
        ) LightSetup.batteryMaker() else null
        val backgroundLocationSettings = step == LightSetup.Step.LOCATION &&
            Build.VERSION.SDK_INT >= 30 && fineLocationAllowed()
        CalmScreen(
            eyebrow = stringResource(R.string.light_step_counter, index + 1, total),
            title = stringResource(if (step == LightSetup.Step.PAIR && LightSetup.profile(this) == "self") R.string.setup_pair_self_title else step.title),
            body = stringResource(when {
                batteryHelp != null -> batteryHelp
                backgroundLocationSettings -> R.string.light_step_location_settings
                step == LightSetup.Step.PAIR && LightSetup.profile(this) == "self" -> R.string.setup_pair_self
                step == LightSetup.Step.ADMIN && LightSetup.profile(this) == "self" -> R.string.setup_admin_self
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
                else -> null
            },
            onSecondary = {
                if (batteryHelp != null && batteryDone) {
                    LightSetup.finishBatteryMakerHelp(this)
                    refresh++
                } else if (step.optional) {
                    if (dashboard) LightSetup.skipOptions(this) else LightSetup.skip(this, step)
                    refresh++
                }
            },
            progress = (index + 1f) / total,
        ) {
            if (step == LightSetup.Step.PAIR && !SyncStore(this@LightSetupActivity).everPaired) {
                OutlinedButton(onClick = ::changeAudience, modifier = Modifier.fillMaxWidth()) {
                    Text(stringResource(R.string.setup_back))
                }
            }
            PermissionIllustration(step)
        }
    }

    @Composable
    private fun DashboardPairStep(index: Int, total: Int) {
        val store = SyncStore(this)
        val linkAvailable = LightSetup.linkReviewed(this) && store.enrollToken() != null
        val paired = store.isPaired
        val canConnect = linkAvailable || paired
        var attempt by remember { mutableIntStateOf(0) }
        var failed by remember { mutableStateOf(false) }
        LaunchedEffect(attempt) {
            if (!canConnect) return@LaunchedEffect
            try {
                val app = applicationContext
                if (!paired) {
                    withContext(Dispatchers.IO) {
                        synchronized(PairingController.enrollmentLock) {
                            PairingActivity.controller(app).enroll()
                        }
                    }
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
            title = stringResource(if (LightSetup.profile(this) == "self") R.string.setup_pair_self_title else R.string.light_step_pair_title),
            body = stringResource(when {
                failed -> R.string.light_link_network
                paired -> R.string.light_link_rules
                store.everPaired -> R.string.light_link_removed
                !linkAvailable -> R.string.light_link_expired
                else -> R.string.light_link_connecting
            }),
            primary = if (failed) stringResource(R.string.light_link_retry) else null,
            onPrimary = { failed = false; attempt++ },
            progress = (index + 1f) / total,
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
            LightSetup.Step.FILTER -> {
                val request = LightSetup.intent(this, step)
                if (request != null && LightFilter.method(this) == FilterMethod.VPN) LightSetup.allowVpnSetup()
                open(request)
            }
            LightSetup.Step.USAGE ->
                open(LightSetup.intent(this, step), Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS))
            else -> {
                requestedStep = step.takeIf { needsRestrictedSettingsHelp(Build.VERSION.SDK_INT, it, false) }
                open(LightSetup.intent(this, step))
            }
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

    @Composable
    private fun PrivateDnsStep(index: Int, total: Int) {
        val host = LightFilter.host(this)
        val handoffBlocked = LightFilter.vpnHandoffBlocked(this)
        LaunchedEffect(host) {
            if (host == null) {
                while (LightFilter.host(this@LightSetupActivity) == null) kotlinx.coroutines.delay(1_000)
                refresh++
            }
        }
        CalmScreen(
            eyebrow = stringResource(R.string.light_step_counter, index + 1, total),
            title = stringResource(R.string.light_private_dns_title),
            body = stringResource(when {
                handoffBlocked -> R.string.light_private_dns_vpn_handoff
                host == null -> R.string.light_private_dns_waiting
                else -> R.string.light_private_dns_body
            }),
            primary = stringResource(when {
                handoffBlocked -> R.string.light_private_dns_vpn_settings
                host == null -> R.string.pairing_retry
                else -> R.string.light_private_dns_settings
            }),
            onPrimary = {
                if (handoffBlocked) {
                    open(Intent(android.provider.Settings.ACTION_VPN_SETTINGS))
                } else if (host == null) {
                    org.plainphone.app.sync.SyncScheduler.now(this, "private DNS setup")
                } else {
                    LightSetup.allowPrivateDnsSetup(this)
                    open(Intent(android.provider.Settings.ACTION_WIRELESS_SETTINGS), Intent(android.provider.Settings.ACTION_SETTINGS))
                }
                refresh++
            },
            secondary = if (host != null && !handoffBlocked) stringResource(R.string.light_private_dns_copy) else null,
            onSecondary = {
                if (host != null) getSystemService(android.content.ClipboardManager::class.java)
                    .setPrimaryClip(android.content.ClipData.newPlainText("Private DNS", host))
            },
            progress = (index + 1f) / total,
        )
    }

    private fun open(intent: Intent?, fallback: Intent = Intent(android.provider.Settings.ACTION_SETTINGS)) {
        if (intent == null) {
            permissionStepReturned()
            return
        }
        try {
            launcher.launch(intent)
        } catch (_: ActivityNotFoundException) {
            runCatching { launcher.launch(fallback) }
        } catch (_: SecurityException) {
            if (requestedStep != null) permissionStepReturned()
            else runCatching { launcher.launch(fallback) }
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
            secondary = if (!SyncStore(this).everPaired) stringResource(R.string.setup_back) else null,
            onSecondary = ::changeAudience,
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
            body = stringResource(if (LightSetup.profile(this) == "self") R.string.setup_done_self else R.string.light_done_body),
            primary = stringResource(R.string.light_done_action),
            onPrimary = onFinish,
            progress = 1f,
        ) {
            if (LightSetup.selfKey(this@LightSetupActivity)?.optString("keyType") == "trustedQr") SelfApprovalAction()
            UndoSetupAction(this@LightSetupActivity, refresh)
        }
    }

    companion object {
        fun intent(context: Context) = Intent(context, LightSetupActivity::class.java)
    }
}
