// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.billing

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClient.BillingResponseCode
import com.android.billingclient.api.BillingClient.ProductType
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import kotlin.coroutines.resume
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.suspendCancellableCoroutine

/** The `play` flavor: Google Play is the only way to pay on the phone. */
object Stores {
    const val available = true

    fun billing(context: Context): StoreBilling? = PlayBilling(context.applicationContext)
}

/**
 * Google Play Billing. The phone buys and reports the purchase token to the server; the server
 * verifies it with Google and then finishes the purchase (it is never finished here, so Google
 * refunds anything the server did not accept).
 */
private class PlayBilling(context: Context) : StoreBilling {
    private var waiting: CompletableDeferred<Pair<BillingResult, List<Purchase>?>>? = null

    private val client = BillingClient.newBuilder(context)
        .setListener { result, purchases -> waiting?.complete(result to purchases) }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    override suspend fun buy(activity: Activity, request: StoreRequest): StoreResult {
        if (!connect()) return StoreResult.Unavailable
        val type = productType(request.kind)
        val details = productDetails(request.productId, type) ?: return StoreResult.Unavailable
        val product = BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(details)
        if (request.kind == StoreRequest.Kind.PLAN) {
            val offer = details.subscriptionOfferDetails?.firstOrNull()?.offerToken ?: return StoreResult.Unavailable
            product.setOfferToken(offer)
        }
        val flow = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(product.build()))
            .setObfuscatedAccountId(request.accountId)
        request.profileId?.let(flow::setObfuscatedProfileId)
        val answer = CompletableDeferred<Pair<BillingResult, List<Purchase>?>>()
        waiting = answer
        try {
            val launched = client.launchBillingFlow(activity, flow.build())
            if (launched.responseCode != BillingResponseCode.OK) return outcome(request, launched.responseCode, null)
            val (result, purchases) = answer.await()
            return outcome(request, result.responseCode, purchases)
        } finally {
            if (waiting === answer) waiting = null
        }
    }

    private suspend fun outcome(request: StoreRequest, code: Int, purchases: List<Purchase>?): StoreResult = when (code) {
        BillingResponseCode.OK -> purchases.orEmpty().firstOrNull { request.productId in it.products }
            ?.let { result(request.kind, it) } ?: StoreResult.Failed
        // Bought before and not yet finished by the server: hand that purchase over again.
        BillingResponseCode.ITEM_ALREADY_OWNED ->
            unconfirmed().firstOrNull { it.productId == request.productId } ?: StoreResult.Pending
        BillingResponseCode.USER_CANCELED -> StoreResult.Cancelled
        BillingResponseCode.BILLING_UNAVAILABLE, BillingResponseCode.SERVICE_UNAVAILABLE,
        BillingResponseCode.FEATURE_NOT_SUPPORTED, BillingResponseCode.ITEM_UNAVAILABLE,
        BillingResponseCode.DEVELOPER_ERROR -> StoreResult.Unavailable
        else -> StoreResult.Failed
    }

    private fun result(kind: StoreRequest.Kind, p: Purchase): StoreResult = when (p.purchaseState) {
        Purchase.PurchaseState.PURCHASED -> StoreResult.Purchased(kind, p.products.first(), p.purchaseToken)
        Purchase.PurchaseState.PENDING -> StoreResult.Pending
        else -> StoreResult.Failed
    }

    override suspend fun unconfirmed(): List<StoreResult.Purchased> {
        if (!connect()) return emptyList()
        return StoreRequest.Kind.entries.flatMap { kind ->
            purchases(productType(kind))
                .filter { it.purchaseState == Purchase.PurchaseState.PURCHASED && !it.isAcknowledged && it.products.isNotEmpty() }
                .map { StoreResult.Purchased(kind, it.products.first(), it.purchaseToken) }
        }
    }

    override fun close() {
        waiting?.cancel()
        client.endConnection()
    }

    private fun productType(kind: StoreRequest.Kind) =
        if (kind == StoreRequest.Kind.PLAN) ProductType.SUBS else ProductType.INAPP

    private suspend fun connect(): Boolean {
        if (client.isReady) return true
        return suspendCancellableCoroutine { cont ->
            client.startConnection(object : BillingClientStateListener {
                override fun onBillingSetupFinished(result: BillingResult) {
                    if (cont.isActive) cont.resume(result.responseCode == BillingResponseCode.OK)
                }

                override fun onBillingServiceDisconnected() {
                    if (cont.isActive) cont.resume(false)
                }
            })
        }
    }

    private suspend fun productDetails(productId: String, type: String): ProductDetails? {
        val product = QueryProductDetailsParams.Product.newBuilder().setProductId(productId).setProductType(type).build()
        val params = QueryProductDetailsParams.newBuilder().setProductList(listOf(product)).build()
        return suspendCancellableCoroutine { cont ->
            client.queryProductDetailsAsync(params) { result, details ->
                val found = if (result.responseCode == BillingResponseCode.OK) details.productDetailsList.firstOrNull() else null
                if (cont.isActive) cont.resume(found)
            }
        }
    }

    private suspend fun purchases(type: String): List<Purchase> = suspendCancellableCoroutine { cont ->
        client.queryPurchasesAsync(QueryPurchasesParams.newBuilder().setProductType(type).build()) { result, list ->
            if (cont.isActive) cont.resume(if (result.responseCode == BillingResponseCode.OK) list else emptyList())
        }
    }
}
