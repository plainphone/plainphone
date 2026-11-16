// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

/**
 * Pairs the phone with a parent account. The phone shows a code and a QR code; the parent
 * claims it in the dashboard; the phone polls and receives its device token exactly once.
 * Pure logic around [SyncApi] and [SyncStore], unit-tested with a fake API.
 */
class PairingController(
    private val store: SyncStore,
    private val api: SyncApi,
    private val nowMs: () -> Long,
    private val deviceInfo: Map<String, String>,
) {
    /** The pairing on screen, if it is still good for at least a little while. */
    fun current(): Pairing? = store.pairing()?.takeIf { it.expiresAtMs - nowMs() > MIN_REMAINING_MS }

    /** Starts a new pairing (or keeps showing the current one). */
    fun start(): Pairing {
        check(!store.isPaired) { "already paired" }
        current()?.let { return it }
        return api.startPairing("strong", deviceInfo).also(store::savePairing)
    }

    /** One poll. On [PairPoll.Paired] the token is stored and the pairing cleared. */
    fun poll(): PairPoll {
        val p = store.pairing() ?: return PairPoll.Expired
        if (p.expiresAtMs <= nowMs()) {
            store.savePairing(null)
            return PairPoll.Expired
        }
        val result = api.pollPairing(p.id, p.pollSecret)
        when (result) {
            is PairPoll.Paired -> store.savePaired(result.phoneId, result.deviceToken)
            PairPoll.Expired -> store.savePairing(null)
            PairPoll.Waiting -> Unit
        }
        return result
    }

    companion object {
        private const val MIN_REMAINING_MS = 60_000L
        /** A phone that has never been paired can be paired without the PIN this long after setup. */
        const val FREE_PAIRING_MS = 60 * 60_000L

        /**
         * Pairing without the maintenance PIN is only for the setup moment. Afterwards (or once the
         * phone was paired and removed) a child, or a Self user wanting out of their key, could pair
         * the phone to an account of their own and open everything.
         */
        fun allowedWithoutPin(everPaired: Boolean, firstLockAtMs: Long?, nowMs: Long): Boolean =
            !everPaired && firstLockAtMs != null && nowMs - firstLockAtMs in 0..FREE_PAIRING_MS
    }
}
