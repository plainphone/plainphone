// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.io.IOException
import java.util.Base64

/** Reversible stand-in for the Android Keystore, which Robolectric does not have. */
class FakeSecretBox : SecretBox {
    override fun seal(plain: String): String = "sealed:" + Base64.getEncoder().encodeToString(plain.toByteArray())
    override fun open(sealed: String): String? =
        sealed.removePrefix("sealed:").takeIf { sealed.startsWith("sealed:") }?.let { String(Base64.getDecoder().decode(it)) }
}

class FakeSyncDevice(
    var apps: List<InstalledApp> = listOf(InstalledApp("com.android.dialer", "Phone", core = true)),
    var fix: LocationFix? = LocationFix(55.6761, 12.5683, 12f, 0L),
) : SyncDevice {
    var now = 1_800_000_000_000L
    var applies = mutableListOf<String>()
    var lock = LockState(deviceOwner = true, maintenance = false, failedPolicies = emptyList(), appliedAtMs = now, dnsHost = "family.adguard-dns.com")
    val locationRequests = mutableListOf<Boolean>()
    /** How old the fix is (a last-known position when no fresh one comes). */
    var fixAgeMs = 0L

    override fun nowMs() = now
    override fun appVersion() = "0.1.2"
    override fun installedApps() = apps
    override fun applyLockIfNeeded(reason: String, maxAgeMs: Long) { applies += reason }
    override fun lockState() = lock
    override fun battery(): Pair<Int?, Boolean?> = 64 to false
    override fun location(precise: Boolean): LocationFix? {
        locationRequests += precise
        return fix?.copy(recordedAtMs = now - fixAgeMs)
    }
}

/** Scriptable server. */
class FakeSyncApi : SyncApi {
    var rules: RulesResult = RulesResult.Unchanged
    var failRules: IOException? = null
    val etagsSent = mutableListOf<String?>()
    val appsReported = mutableListOf<List<InstalledApp>>()
    val locations = mutableListOf<LocationFix>()
    val statuses = mutableListOf<DeviceStatus>()
    var pairing = Pairing("p1", "K7MP4QXR", "secret", "https://app.example.test/pair?code=K7MP4QXR", Long.MAX_VALUE)
    var pollResult: PairPoll = PairPoll.Waiting
    val tokensUsed = mutableListOf<String>()

    override fun startPairing(mode: String, deviceInfo: Map<String, String>) = pairing
    override fun pollPairing(pairingId: String, pollSecret: String): PairPoll {
        check(pollSecret == pairing.pollSecret) { "wrong poll secret" }
        return pollResult
    }
    override fun fetchRules(token: String, etag: String?): RulesResult {
        tokensUsed += token
        etagsSent += etag
        failRules?.let { throw it }
        return rules
    }
    override fun reportApps(token: String, apps: List<InstalledApp>) { appsReported += apps }
    override fun reportLocation(token: String, fix: LocationFix): Boolean { locations += fix; return true }
    override fun reportStatus(token: String, status: DeviceStatus) { statuses += status }
}

/** A rules document like the server's (server/src/services/phones.ts). */
fun rulesJson(
    allowed: List<String> = listOf("com.android.dialer", "com.spotify.music"),
    hidden: List<String> = listOf("com.example.game"),
    contacts: String = """[{"name":"Mum","number":"+4512345678"}]""",
    schedules: String = "[]",
    dnsReady: Boolean? = true,
    locationEnabled: Boolean = true,
    requestedAt: String? = null,
    timezone: String = "Europe/Copenhagen",
): String {
    val ready = dnsReady?.let { ""","ready":$it""" } ?: ""
    val req = requestedAt?.let { "\"$it\"" } ?: "null"
    return """
    {"phoneId":"7f1c2b9e-0000-4000-8000-000000000001","profile":"child","mode":"strong","timezone":"$timezone",
     "apps":{"allowed":${allowed.joinToString(",", "[", "]") { "\"$it\"" }},"hidden":${hidden.joinToString(",", "[", "]") { "\"$it\"" }}},
     "contacts":$contacts,
     "schedules":$schedules,
     "dns":{"host":"abcdefghijklmnopqrst.dns.plainphone.org"$ready,"blockedCategories":["adult"]},
     "location":{"enabled":$locationEnabled,"intervalMinutes":5,"requestedAt":$req},
     "pendingChanges":[],
     "pollSeconds":60}
    """.trimIndent()
}
