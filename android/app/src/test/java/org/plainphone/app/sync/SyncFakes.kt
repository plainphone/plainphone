// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.io.IOException
import java.util.Base64
import org.plainphone.app.StepResult

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
    var cachedLocation: LocationFix? = null
    var lastKnownFix: LocationFix? = null
    override fun lastKnownLocation() = lastKnownFix
    override fun cachedCoarseLocation() = cachedLocation
    val locationRequests = mutableListOf<Boolean>()
    val freshLocationRequests = mutableListOf<Boolean>()
    /** How old the fix is (a last-known position when no fresh one comes). */
    var fixAgeMs = 0L
    var locationDelayMs = 0L
    var beforeLocation: (() -> Unit)? = null
    /** What the next [release] reports; make a step fail to play a release that did not hold. */
    var releaseResults: List<StepResult> = listOf(StepResult("give up Device Owner", true))
    var releases = 0

    override fun nowMs() = now
    override fun appVersion() = "0.1.2"
    var installedAppsCalls = 0
    override fun installedApps(): List<InstalledApp> {
        installedAppsCalls++
        return apps
    }
    override fun applyLockIfNeeded(reason: String, maxAgeMs: Long) { applies += reason }
    override fun lockState() = lock
    override fun release(): List<StepResult> {
        releases++
        return releaseResults
    }
    override fun battery(): Pair<Int?, Boolean?> = 64 to false
    override fun location(precise: Boolean, notBeforeMs: Long?, fresh: Boolean): LocationFix? {
        beforeLocation?.invoke()
        locationRequests += precise
        freshLocationRequests += fresh
        now += locationDelayMs
        return fix?.copy(recordedAtMs = now - fixAgeMs)
    }

    val safetyRules = mutableListOf<ServerRules>()
    val pendingEvents = mutableListOf<SafetyEvent>()
    val answeredCheckIns = mutableSetOf<String>()
    val positionsShown = mutableListOf<String>()
    override fun onSafetyRules(rules: ServerRules) { safetyRules += rules }
    override fun pendingSafetyEvents() = pendingEvents.toList()
    override fun safetyEventDone(event: SafetyEvent) { pendingEvents -= event }
    override fun checkInAnswered(id: String) = id in answeredCheckIns
    override fun positionSent(why: String) { positionsShown += why }
}

/** Scriptable server. */
class FakeSyncApi : SyncApi {
    var rules: RulesResult = RulesResult.Unchanged
    var failRules: IOException? = null
    val etagsSent = mutableListOf<String?>()
    var onReportApps: (() -> Unit)? = null
    val appsReported = mutableListOf<List<InstalledApp>>()
    val locations = mutableListOf<LocationFix>()
    val statuses = mutableListOf<DeviceStatus>()
    val safetyEvents = mutableListOf<SafetyEvent>()
    /** What PUT /device/location answers: false = 409. */
    var locationAccepted = true
    var locationFailure: IOException? = null
    var beforeLocationUpload: ((String) -> Unit)? = null
    var pairing = Pairing("p1", "K7MP4QXR", "secret", "https://app.example.test/pair?code=K7MP4QXR", Long.MAX_VALUE)
    var pollResult: PairPoll = PairPoll.Waiting
    val tokensUsed = mutableListOf<String>()
    var enrollResult: EnrollResult = EnrollResult.Rejected
    var enrollFailure: IOException? = null
    val enrollCalls: MutableList<Pair<String, String>> = java.util.Collections.synchronizedList(mutableListOf())
    var enrollDelayMs = 0L
    /** What the server answers to "Plainphone is off": true = deleted (204/401), false = 409. */
    var ackResult = true
    var ackFailure: IOException? = null
    val acks = mutableListOf<String>()

    override fun startPairing(mode: String, deviceInfo: Map<String, String>) = pairing
    override fun pollPairing(pairingId: String, pollSecret: String): PairPoll {
        check(pollSecret == pairing.pollSecret) { "wrong poll secret" }
        return pollResult
    }
    override fun enroll(token: String, installId: String, deviceInfo: Map<String, String>): EnrollResult {
        enrollCalls += token to installId
        if (enrollDelayMs > 0) Thread.sleep(enrollDelayMs)
        enrollFailure?.let { throw it }
        return enrollResult
    }
    override fun fetchRules(token: String, etag: String?): RulesResult {
        tokensUsed += token
        etagsSent += etag
        failRules?.let { throw it }
        return rules
    }
    override fun reportApps(token: String, apps: List<InstalledApp>) {
        onReportApps?.invoke()
        appsReported += apps
    }
    val locationPurposes = mutableListOf<String>()

    override fun reportLocation(token: String, fix: LocationFix, purpose: String): Boolean {
        beforeLocationUpload?.invoke(purpose)
        locationFailure?.let { throw it }
        locationPurposes += purpose
        locations += fix
        return locationAccepted
    }
    override fun reportSafety(token: String, requestId: String, event: String): Boolean {
        safetyEvents += SafetyEvent(requestId, event)
        return true
    }
    override fun reportStatus(token: String, status: DeviceStatus) { statuses += status }
    override fun ackReleased(token: String): Boolean {
        acks += token
        ackFailure?.let { throw it }
        return ackResult
    }
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
    toInstall: String? = null,
    timeLimits: String? = null,
    release: Boolean? = null,
    /** null = an older server without location modes. */
    locationMode: String? = null,
    ring: String? = null,
    checkIn: String? = null,
): String {
    val mode = locationMode?.let { ""","mode":"$it"""" } ?: ""
    val safety = (ring?.let { ""","ring":$it""" } ?: "") + (checkIn?.let { ""","checkIn":$it""" } ?: "")
    val install = toInstall?.let { ""","toInstall":$it""" } ?: ""
    val limits = timeLimits?.let { ""","timeLimits":$it""" } ?: ""
    val rel = release?.let { ""","release":$it""" } ?: ""
    val ready = dnsReady?.let { ""","ready":$it""" } ?: ""
    val req = requestedAt?.let { "\"$it\"" } ?: "null"
    return """
    {"phoneId":"7f1c2b9e-0000-4000-8000-000000000001","profile":"child","mode":"strong","timezone":"$timezone",
     "apps":{"allowed":${allowed.joinToString(",", "[", "]") { "\"$it\"" }},"hidden":${hidden.joinToString(",", "[", "]") { "\"$it\"" }}$install},
     "contacts":$contacts,
     "schedules":$schedules,
     "dns":{"host":"abcdefghijklmnopqrst.dns.plainphone.org"$ready,"blockedCategories":["adult"]},
     "location":{"enabled":$locationEnabled$mode,"intervalMinutes":5,"requestedAt":$req}$safety,
     "pendingChanges":[]$rel,
     "pollSeconds":60$limits}
    """.trimIndent()
}
