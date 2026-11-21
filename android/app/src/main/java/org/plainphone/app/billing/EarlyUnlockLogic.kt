// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.billing

import java.math.BigDecimal
import java.text.NumberFormat
import java.time.Instant
import java.util.Currency
import java.util.Locale
import org.plainphone.app.sync.EarlyUnlockOffer
import org.plainphone.app.sync.PendingChange
import org.plainphone.app.sync.ServerRules

/** What the early unlock element shows next to one pending change. Pure, so the rules are testable. */
sealed interface EarlyUnlockShow {
    val changeId: String

    /** "Keep waiting (free)" and "Unlock in about N min for {price}", equally prominent. */
    data class Offer(
        override val changeId: String,
        val effectiveAt: Instant?,
        val price: Int,
        val currency: String,
        val unlockMinutes: Int,
    ) : EarlyUnlockShow

    /** The weekly cap is reached; the next early unlock is possible from [nextAvailableAt]. */
    data class WeeklyCap(override val changeId: String, val effectiveAt: Instant?, val nextAvailableAt: Instant) : EarlyUnlockShow

    /** Paid and waiting the last few minutes; "Withdraw from contract" stays visible while [canWithdraw]. */
    data class Scheduled(
        override val changeId: String,
        val purchaseId: String,
        val unlockAt: Instant?,
        val canWithdraw: Boolean,
    ) : EarlyUnlockShow
}

object EarlyUnlockLogic {
    /**
     * Whether a Myself phone's rules allow the element at all: the server sends `earlyUnlock` only
     * for the user's own wait-time key, never for a child phone or a trusted person's key.
     */
    fun relevant(rules: ServerRules?): Boolean =
        rules != null && rules.profile == "self" && rules.earlyUnlock != null &&
            rules.pendingChanges.any { it.keyType == PendingChange.KEY_DELAY }

    /** One entry per delay-key change in the rules that has something to show, in the rules' order. */
    fun forRules(rules: ServerRules?, offers: List<EarlyUnlockOffer>, now: Instant, dismissed: Set<String>): List<EarlyUnlockShow> {
        if (!relevant(rules)) return emptyList()
        val byChange = offers.associateBy { it.changeId }
        return rules!!.pendingChanges
            .filter { it.keyType == PendingChange.KEY_DELAY }
            .mapNotNull { change -> byChange[change.id]?.let { show(it, now, dismissed) } }
    }

    fun show(offer: EarlyUnlockOffer, now: Instant, dismissed: Set<String>): EarlyUnlockShow? {
        val purchase = offer.purchase
        // A paid unlock always shows, also after "Keep waiting": the withdrawal must stay findable.
        if (purchase != null && purchase.status == "scheduled") {
            return EarlyUnlockShow.Scheduled(offer.changeId, purchase.id, purchase.unlockAt, purchase.canWithdraw)
        }
        if (offer.changeId in dismissed) return null
        // Already due, or due before an unlock bought now would be: nothing to gain.
        val effective = offer.effectiveAt
        if (effective != null && !effective.isAfter(now.plusSeconds(offer.unlockMinutes * 60L))) return null
        return when {
            offer.available -> EarlyUnlockShow.Offer(offer.changeId, effective, offer.price, offer.currency, offer.unlockMinutes)
            offer.reason == "weeklyCap" -> offer.nextAvailableAt
                ?.takeIf { it.isAfter(now) && (effective == null || it.isBefore(effective)) }
                ?.let { EarlyUnlockShow.WeeklyCap(offer.changeId, effective, it) }
            else -> null
        }
    }

    /** The pay button works only once the user ticked the express consent themselves. */
    fun payEnabled(consentTicked: Boolean, busy: Boolean): Boolean = consentTicked && !busy

    /** [minor] units of [currency] as the user's locale writes money, e.g. "10,00 kr.". */
    fun price(minor: Int, currency: String, locale: Locale): String {
        val c = Currency.getInstance(currency)
        val digits = c.defaultFractionDigits.coerceAtLeast(0)
        return NumberFormat.getCurrencyInstance(locale).apply { this.currency = c }
            .format(BigDecimal.valueOf(minor.toLong(), digits))
    }
}
