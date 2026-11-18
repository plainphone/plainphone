// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

/**
 * Pairs the phone with a parent account. With a provisioning QR code made in the dashboard the
 * phone pairs itself with the code's one-time token ([enroll]). Otherwise the phone shows a code and
 * a QR code; the parent claims it in the dashboard; the phone polls and receives its device token.
 * Pure logic around [SyncApi] and [SyncStore], unit-tested with a fake API.
 */
class PairingController(
    private val store: SyncStore,
    private val api: SyncApi,
    private val deviceInfo: Map<String, String>,
    /** "strong" (Device Owner) or "light" (an ordinary app), sent with the pairing. */
    private val mode: String = "strong",
    private val profile: String? = null,
    private val canRedeemEnrollment: () -> Boolean = { true },
) {
    /** Starts a new pairing (or keeps showing the current one). */
    fun start(): Pairing {
        check(!store.isPaired) { "already paired" }
        // The server can still recover a claimed pairing after the displayed code expires.
        store.pairing()?.let { return it }
        return api.startConfirmedPairing(mode, deviceInfo, profile).also(store::savePairing)
    }

    /**
     * Pairs with the enrollment token from the provisioning QR code, if there is one: no code to type.
     * Returns null when there is no token (or the phone is already paired). A refused token is dropped,
     * so the phone falls back to showing a code. Network errors throw and keep the token for a retry.
     */
    fun enroll(): EnrollResult? = synchronized(enrollmentLock) {
        // One at a time per process: the pairing screen and EnrollWorker may both try. Two requests
        // with the same token would each get a device token (the retry path), and the one saved
        // last could be the one the server already replaced.
        if (store.isPaired) {
            store.saveEnrollToken(null)
            return null
        }
        if (!canRedeemEnrollment()) return null
        val token = store.enrollToken() ?: return null
        val result = api.enroll(token, store.installId(), deviceInfo)
        when (result) {
            is EnrollResult.Paired -> store.savePaired(result.phoneId, result.deviceToken, result.account.takeIf { mode == "strong" }, result.setupUndoMinutes)
            EnrollResult.Rejected -> store.saveEnrollToken(null)
            EnrollResult.InvalidKey -> store.clearEnrollmentConfirmation()
        }
        return result
    }

    /** One poll. On [PairPoll.Paired] the token is stored and the pairing cleared. */
    fun poll(): PairPoll {
        val p = store.pairing() ?: return PairPoll.Expired
        val polled = api.pollPairing(p.id, p.pollSecret)
        // A strong-mode code issued by an earlier app build may still require confirmation.
        val result = if (polled is PairPoll.Confirm && mode == "strong") api.decidePairing(p, true) else polled
        when (result) {
            is PairPoll.Paired -> store.savePaired(result.phoneId, result.deviceToken, result.account.takeIf { mode == "strong" }, result.setupUndoMinutes)
            PairPoll.Expired -> store.savePairing(null)
            is PairPoll.Confirm, PairPoll.InvalidKey, PairPoll.Waiting -> Unit
        }
        return result
    }

    fun decide(confirm: Boolean): PairPoll {
        val pairing = store.pairing() ?: return PairPoll.Expired
        return api.decidePairing(pairing, confirm).also {
            if (it is PairPoll.Paired) store.savePaired(it.phoneId, it.deviceToken, it.account.takeIf { mode == "strong" }, it.setupUndoMinutes)
            if (it == PairPoll.Expired) store.savePairing(null)
        }
    }

    companion object {
        internal val enrollmentLock = Any()
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
