// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.time.Instant
import org.json.JSONObject

/**
 * Paid early unlock (docs/billing.md, #103). The rules carry this only while billing is on, the
 * phone is a Myself phone with its own wait-time (delay) key and the phone's switch is on. Missing
 * means: show nothing.
 */
data class EarlyUnlockRules(val price: Int, val currency: String) {
    companion object {
        /** Lenient: a malformed block hides the offer, it never breaks the rules. */
        fun parse(j: JSONObject?): EarlyUnlockRules? {
            if (j == null || !j.optBoolean("enabled", false)) return null
            val price = j.optInt("price", -1)
            val currency = j.optString("currency", "")
            if (price <= 0 || currency.length != 3) return null
            return EarlyUnlockRules(price, currency.uppercase())
        }
    }
}

/** A change that waits for its key (`pendingChanges` in the rules). */
data class PendingChange(val id: String, val keyType: String, val effectiveAt: Instant?) {
    companion object {
        const val KEY_DELAY = "delay"

        fun parseList(j: JSONObject): List<PendingChange> {
            val a = j.optJSONArray("pendingChanges") ?: return emptyList()
            return (0 until a.length()).mapNotNull { i ->
                val o = a.optJSONObject(i) ?: return@mapNotNull null
                val id = o.optString("id", "").takeIf(String::isNotEmpty) ?: return@mapNotNull null
                PendingChange(id, o.optString("keyType", ""), instant(o, "effectiveAt"))
            }
        }
    }
}

/** One early unlock purchase as the server shows it (`purchaseJson` in server/src/services/early-unlock.ts). */
data class EarlyUnlockPurchase(
    /** Also the contract number the user sees next to "Withdraw from contract". */
    val id: String,
    val status: String,
    val amount: Int,
    val currency: String,
    val unlockAt: Instant?,
    val canWithdraw: Boolean,
) {
    companion object {
        fun parse(o: JSONObject) = EarlyUnlockPurchase(
            id = o.getString("id"),
            status = o.getString("status"),
            amount = o.getInt("amount"),
            currency = o.getString("currency"),
            unlockAt = instant(o, "unlockAt"),
            canWithdraw = o.optBoolean("canWithdraw", false),
        )
    }
}

/** `GET /device/early-unlocks`: the offer next to one pending change. */
data class EarlyUnlockOffer(
    val changeId: String,
    val effectiveAt: Instant?,
    val available: Boolean,
    /** savesNoTime, weeklyCap or inProgress; null when [available]. */
    val reason: String?,
    val price: Int,
    val currency: String,
    val unlockMinutes: Int,
    val nextAvailableAt: Instant?,
    val purchase: EarlyUnlockPurchase?,
) {
    companion object {
        fun parseList(body: String): List<EarlyUnlockOffer> {
            val a = JSONObject(body).getJSONArray("offers")
            return (0 until a.length()).map { i ->
                val row = a.getJSONObject(i)
                val o = row.getJSONObject("offer")
                EarlyUnlockOffer(
                    changeId = row.getString("changeId"),
                    effectiveAt = instant(row, "effectiveAt"),
                    available = o.getBoolean("available"),
                    reason = o.optString("reason", "").takeIf { it.isNotEmpty() && it != "null" },
                    price = o.getInt("price"),
                    currency = o.getString("currency"),
                    unlockMinutes = o.optInt("unlockMinutes", 10),
                    nextAvailableAt = instant(o, "nextAvailableAt"),
                    purchase = o.optJSONObject("purchase")?.let(EarlyUnlockPurchase::parse),
                )
            }
        }
    }
}

/** `POST /device/early-unlocks`: the purchase row and what to buy at Google Play for it. */
data class EarlyUnlockStart(val purchase: EarlyUnlockPurchase, val productId: String, val accountId: String)

/** `GET /device/billing`: the Play product ids; [play] is null when the server has no Play set up. */
data class DeviceBilling(val plan: String, val play: Play?) {
    data class Play(val earlyUnlockProductId: String, val plusProductId: String, val accountId: String)

    companion object {
        fun parse(body: String): DeviceBilling {
            val j = JSONObject(body)
            val play = j.optJSONObject("play")?.let {
                Play(it.getString("earlyUnlockProductId"), it.getString("plusProductId"), it.getString("accountId"))
            }
            return DeviceBilling(j.optString("plan", "free"), play)
        }
    }
}

private fun instant(o: JSONObject, key: String): Instant? =
    o.optString(key, "").takeIf { it.isNotEmpty() && it != "null" }?.let { runCatching { Instant.parse(it) }.getOrNull() }
