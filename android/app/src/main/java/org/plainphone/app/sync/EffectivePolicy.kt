// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.security.MessageDigest
import java.time.Instant
import org.plainphone.app.PolicyConfig
import org.plainphone.app.ServerOverlay

/**
 * Merges the parent's rules from the server into the lock config from the QR code.
 * Pure logic, unit-tested on the JVM.
 *
 * Nothing here can loosen the lock because the server is unreachable: [rules] are the last
 * rules the phone received and stored, and they keep applying offline.
 */
object EffectivePolicy {

    /**
     * @param removed the phone was removed in the dashboard. Its last rules keep applying, but the
     *   DNS service has deleted its ClientID, so the phone goes back to the QR code's DNS host.
     */
    fun merge(qr: PolicyConfig, rules: ServerRules?, now: Instant, removed: Boolean = false): PolicyConfig {
        if (rules == null) return qr
        val windows = Schedules.active(rules.schedules, now, rules.timezone)
        val windowAllowed = Schedules.allowedDuringWindows(windows)
        return qr.copy(
            // The phone's own DNS address only once the DNS service knows it. Until then the
            // placeholder from the QR code stays, so the network never dies (an unknown ClientID
            // gets no answers at all).
            dnsHost = if (rules.dnsReady && rules.dnsHost != null && !removed) rules.dnsHost else qr.dnsHost,
            // During a window, an app needs both: the window allows it and the app list shows it.
            allowedPackages = windowAllowed?.let { it intersect rules.allowedApps } ?: rules.allowedApps,
            server = ServerOverlay(windowActive = windows.isNotEmpty(), locationRequired = rules.locationEnabled),
        )
    }

    /** Identifies a merged config, so the phone re-applies the lock only when something changed. */
    fun fingerprint(config: PolicyConfig): String {
        val text = listOf(
            config.dnsHost,
            config.allowedPackages.sorted().joinToString(","),
            config.server?.windowActive.toString(),
            config.server?.locationRequired.toString(),
            config.frpAccountIds.sorted().joinToString(","),
        ).joinToString("|")
        return MessageDigest.getInstance("SHA-256").digest(text.toByteArray()).joinToString("") { "%02x".format(it) }
    }
}
