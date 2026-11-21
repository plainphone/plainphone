// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.billing

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.text.format.DateUtils
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.io.IOException
import java.time.Instant
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.ConfigStore
import org.plainphone.app.R
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncStore

/**
 * Paid early unlock on "Today" (docs/billing.md, #103). Play builds only, and only while the rules
 * carry `earlyUnlock` (a Myself phone's own wait-time key). Shows nothing in every other case.
 * Emergency access and device recovery are never part of this.
 */
@Composable
internal fun EarlyUnlockSection(clock: () -> Instant = Instant::now) {
    if (!Stores.available) return
    val context = LocalContext.current
    val app = context.applicationContext
    val rules = SyncStore(app).rules()
    if (!EarlyUnlockLogic.relevant(rules)) return
    val token = SyncStore(app).deviceToken() ?: return
    val activity = context.findActivity() ?: return
    val store = remember { Stores.billing(app) } ?: return
    DisposableEffect(store) { onDispose { store.close() } }
    val api = remember { PlainphoneApi(ConfigStore(app).load().serverUrl, app) }
    val scope = rememberCoroutineScope()
    val locale = LocalConfiguration.current.locales[0]
    var offers by remember { mutableStateOf<List<org.plainphone.app.sync.EarlyUnlockOffer>>(emptyList()) }
    var reload by remember { mutableIntStateOf(0) }
    var dismissed by remember { mutableStateOf(EarlyUnlockPrefs.dismissed(app)) }
    var message by remember { mutableStateOf<Int?>(null) }
    var busy by remember { mutableStateOf(false) }
    var paying by remember { mutableStateOf<EarlyUnlockShow.Offer?>(null) }
    var withdrawing by remember { mutableStateOf<EarlyUnlockShow.Scheduled?>(null) }

    LaunchedEffect(reload) {
        // Purchases paid while the app was closed or offline go to the server first, quietly.
        for (p in store.unconfirmed()) {
            try {
                withContext(Dispatchers.IO) { api.reportPlayPurchase(token, p.kind.wire, p.productId, p.purchaseToken) }
            } catch (_: IOException) {
                // Tried again next time; the server also hears from Google directly.
            }
        }
        offers = try {
            withContext(Dispatchers.IO) { api.earlyUnlockOffers(token) }
        } catch (_: IOException) {
            emptyList()
        }
    }

    val items = EarlyUnlockLogic.forRules(rules, offers, clock(), dismissed)
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        items.forEach { item ->
            when (item) {
                is EarlyUnlockShow.Offer -> {
                    item.effectiveAt?.let { Text(stringResource(R.string.early_unlock_waiting, whenText(app, it))) }
                    // The two choices look the same on purpose: waiting is as easy as paying.
                    OutlinedButton(
                        onClick = {
                            EarlyUnlockPrefs.dismiss(app, item.changeId)
                            dismissed = dismissed + item.changeId
                        },
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) { Text(stringResource(R.string.early_unlock_keep_waiting)) }
                    OutlinedButton(
                        onClick = { message = null; paying = item },
                        enabled = !busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                    ) {
                        Text(stringResource(R.string.early_unlock_pay, item.unlockMinutes, EarlyUnlockLogic.price(item.price, item.currency, locale)))
                    }
                }
                is EarlyUnlockShow.WeeklyCap ->
                    Text(stringResource(R.string.early_unlock_cap, whenText(app, item.nextAvailableAt)))
                is EarlyUnlockShow.Scheduled -> {
                    item.unlockAt?.let { Text(stringResource(R.string.early_unlock_scheduled, whenText(app, it))) }
                    if (item.canWithdraw) {
                        OutlinedButton(
                            onClick = { message = null; withdrawing = item },
                            enabled = !busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp),
                        ) { Text(stringResource(R.string.early_unlock_withdraw)) }
                    }
                }
            }
        }
        if (busy) Text(stringResource(R.string.early_unlock_busy), Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        message?.let { Text(stringResource(it), Modifier.semantics { liveRegion = LiveRegionMode.Polite }) }
    }

    paying?.let { offer ->
        PayDialog(
            offer = offer,
            priceText = EarlyUnlockLogic.price(offer.price, offer.currency, locale),
            onCancel = { paying = null },
            onPay = {
                paying = null
                busy = true
                scope.launch {
                    message = pay(activity, store, api, token, offer.changeId)
                    busy = false
                    reload++
                }
            },
        )
    }

    withdrawing?.let { scheduled ->
        AlertDialog(
            onDismissRequest = { withdrawing = null },
            title = { Text(stringResource(R.string.early_unlock_withdraw)) },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(stringResource(R.string.early_unlock_contract_number, scheduled.purchaseId))
                    Text(stringResource(R.string.early_unlock_withdraw_effect))
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    withdrawing = null
                    busy = true
                    scope.launch {
                        message = try {
                            withContext(Dispatchers.IO) { api.withdrawEarlyUnlock(token, scheduled.purchaseId) }
                            R.string.early_unlock_withdrawn
                        } catch (e: HttpError) {
                            if (e.status == 409) R.string.early_unlock_withdraw_too_late else R.string.early_unlock_withdraw_failed
                        } catch (_: IOException) {
                            R.string.early_unlock_withdraw_failed
                        }
                        busy = false
                        reload++
                    }
                }) { Text(stringResource(R.string.early_unlock_withdraw_confirm)) }
            },
            dismissButton = { TextButton(onClick = { withdrawing = null }) { Text(stringResource(android.R.string.cancel)) } },
        )
    }
}

/** Pre-contract information, the unticked express consent, and the pay button that waits for it. */
@Composable
private fun PayDialog(offer: EarlyUnlockShow.Offer, priceText: String, onCancel: () -> Unit, onPay: () -> Unit) {
    var consent by remember(offer.changeId) { mutableStateOf(false) }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text(stringResource(R.string.early_unlock_title)) },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(stringResource(R.string.early_unlock_info_price, priceText))
                Text(stringResource(R.string.early_unlock_info_when, offer.unlockMinutes))
                Text(stringResource(R.string.early_unlock_info_cap))
                Text(stringResource(R.string.early_unlock_info_withdraw))
                Row(
                    Modifier
                        .fillMaxWidth()
                        .toggleable(value = consent, role = Role.Checkbox, onValueChange = { consent = it })
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Checkbox(checked = consent, onCheckedChange = null)
                    Spacer(Modifier.width(12.dp))
                    Text(stringResource(R.string.early_unlock_consent), style = MaterialTheme.typography.bodyMedium)
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onPay, enabled = EarlyUnlockLogic.payEnabled(consent, busy = false)) {
                Text(stringResource(R.string.early_unlock_pay_now, priceText))
            }
        },
        dismissButton = { TextButton(onClick = onCancel) { Text(stringResource(android.R.string.cancel)) } },
    )
}

/** Starts the purchase on the server, opens Google Play and reports the result. Returns the line to show. */
private suspend fun pay(activity: Activity, store: StoreBilling, api: PlainphoneApi, token: String, changeId: String): Int? {
    val start = try {
        withContext(Dispatchers.IO) { api.startEarlyUnlock(token, changeId) }
    } catch (_: IOException) {
        return R.string.early_unlock_failed
    }
    val request = StoreRequest(StoreRequest.Kind.EARLY_UNLOCK, start.productId, start.accountId, start.purchase.id)
    return when (val result = store.buy(activity, request)) {
        is StoreResult.Purchased -> try {
            withContext(Dispatchers.IO) { api.reportPlayPurchase(token, result.kind.wire, result.productId, result.purchaseToken) }
            R.string.early_unlock_paid
        } catch (_: IOException) {
            // Paid at Google: the next visit (or Google's own notice to the server) finishes it.
            R.string.early_unlock_paid_confirming
        }
        StoreResult.Pending -> R.string.early_unlock_pending
        StoreResult.Cancelled -> null
        StoreResult.Unavailable -> R.string.early_unlock_unavailable
        StoreResult.Failed -> R.string.early_unlock_failed
    }
}

/** A time today ("14:05"), or with the weekday and date when it is another day. */
private fun whenText(context: Context, at: Instant): String {
    val ms = at.toEpochMilli()
    val flags = if (DateUtils.isToday(ms)) DateUtils.FORMAT_SHOW_TIME
    else DateUtils.FORMAT_SHOW_TIME or DateUtils.FORMAT_SHOW_WEEKDAY or DateUtils.FORMAT_SHOW_DATE
    return DateUtils.formatDateTime(context, ms, flags)
}

private tailrec fun Context.findActivity(): Activity? = when (this) {
    is Activity -> this
    is ContextWrapper -> baseContext.findActivity()
    else -> null
}

/** "Keep waiting (free)" is remembered per change, so the same offer never asks twice. */
internal object EarlyUnlockPrefs {
    private const val FILE = "early_unlock"
    private const val KEY = "dismissed"

    fun dismissed(context: Context): Set<String> =
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).getStringSet(KEY, emptySet()).orEmpty().toSet()

    fun dismiss(context: Context, changeId: String) {
        context.getSharedPreferences(FILE, Context.MODE_PRIVATE).edit()
            .putStringSet(KEY, dismissed(context) + changeId).apply()
    }
}
