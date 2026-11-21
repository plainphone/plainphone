// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.billing

import android.app.Activity

/**
 * The app store's payment sheet. Only Play builds (`-PplainphonePlay=true`) have one; the direct
 * build's [Stores.billing] returns null and shows no paid offer at all.
 *
 * The phone only buys and then reports the purchase token to the server. The server verifies it at
 * the store and then acknowledges or consumes it; the phone never does either itself.
 */
interface StoreBilling {
    /** Opens the store's purchase sheet for [request] and waits for the outcome. Call on the main thread. */
    suspend fun buy(activity: Activity, request: StoreRequest): StoreResult

    /** Finished purchases the server has not confirmed yet (paid while the app was closed or offline). */
    suspend fun unconfirmed(): List<StoreResult.Purchased>

    fun close()
}

data class StoreRequest(
    val kind: Kind,
    val productId: String,
    /** The household id; the server checks the purchase belongs to it. */
    val accountId: String,
    /** The early unlock purchase id from the server; null for the plan. */
    val profileId: String?,
) {
    enum class Kind(val wire: String) { EARLY_UNLOCK("earlyUnlock"), PLAN("plan") }
}

sealed interface StoreResult {
    data class Purchased(val kind: StoreRequest.Kind, val productId: String, val purchaseToken: String) : StoreResult
    /** The store accepted the order but the money has not come through (cash, bank). The server learns later. */
    data object Pending : StoreResult
    data object Cancelled : StoreResult
    /** The store is missing, signed out or cannot sell this product here. */
    data object Unavailable : StoreResult
    data object Failed : StoreResult
}
