// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import org.plainphone.app.PhoneLanguage
import org.plainphone.app.light.FilterMethod

import java.time.Instant
import java.time.LocalTime
import java.time.ZoneId
import org.json.JSONArray
import org.json.JSONObject
import org.plainphone.app.PolicyConfig
import org.plainphone.app.contacts.ApprovedContact
import org.plainphone.app.home.HomePrefs
import org.plainphone.app.settings.PhoneSettings

/**
 * The rules document from `GET /device/rules` (server/openapi.yaml, docs/sync-api.md).
 * It is the complete truth for the phone: there are no deltas.
 */
data class ServerRules(
    val phoneId: String,
    val profile: String,
    val timezone: ZoneId,
    val allowedApps: Set<String>,
    val hiddenApps: Set<String>,
    /**
     * Open mode (docs/open-mode.md): every app is allowed except [blockedApps], also apps the
     * rules have never listed. Missing from older servers: the allow-list applies.
     */
    val openApps: Boolean = false,
    val blockedApps: Set<String> = emptySet(),
    val contacts: List<ApprovedContact>,
    val schedules: List<Schedule>,
    /** `<id>.dns.plainphone.org`; only used once [dnsReady] says the DNS service knows the id. */
    val dnsHost: String?,
    val dnsReady: Boolean,
    val locationEnabled: Boolean,
    val locationIntervalMinutes: Int,
    /** Set when a parent pressed "Find" and the phone has not answered yet. */
    val locateRequestedAt: Instant?,
    val pollSeconds: Int,
    /** #20: the parents' Google account IDs for factory reset protection. Empty clears the policy. */
    val filterMethod: FilterMethod = FilterMethod.VPN,
    val privateDnsReady: Boolean = false,
    val frpAccountIds: Set<String> = emptySet(),
    /** Phone settings the parent set or locked (docs/phone-settings.md). Empty from older servers. */
    val settings: PhoneSettings = PhoneSettings.NONE,
    /** How the home screen looks. Defaults from older servers. */
    val home: HomePrefs = HomePrefs.DEFAULT,
    /** Set when a parent pressed "Update now"; the phone checks for a new app version at once. */
    val updateRequestedAt: Instant? = null,
    /** Apps the parent picked from the catalog that are not installed yet. Treated as allowed. */
    val toInstall: List<CatalogInstall> = emptyList(),
    /** Daily minutes per app and in total (docs/time-limits.md). */
    val timeLimits: TimeLimits = TimeLimits.NONE,
    /**
     * The parents released the phone: switch Plainphone off, never lock again and tell the
     * server (docs/sync-api.md, "Releasing the phone"). Missing from older servers: false.
     */
    val release: Boolean = false,
    val supportEnabled: Boolean = true,
    val releaseWarningsEnabled: Boolean = true,
    /** The stop screen offers "Ask for more time" (docs/time-limits.md). Missing from older servers: true. */
    val askMoreTimeEnabled: Boolean = true,
    /** A quiet notice 5 minutes before a time limit runs out. Missing from older servers: true. */
    val limitWarningEnabled: Boolean = true,
    /** When to send a position: off, find, checkin or always (docs/location.md). */
    val locationMode: String = if (locationEnabled) LOCATION_ALWAYS else LOCATION_OFF,
    /** When "always" ends by itself (the server falls back to "checkin"); null otherwise. */
    val sos: SosRules? = null,
    /** The family inbox (InboxRules.kt); off when missing. */
    val inbox: InboxRules = InboxRules.OFF,
    val locationAlwaysUntil: Instant? = null,
    /** An open "Ring the phone"; null means stop. */
    val ring: RingRequest? = null,
    /** An open "Are you okay?"; null means close it. */
    val checkIn: CheckInRequest? = null,
    /** The phone reads its contacts and suggests them to the parents. */
    val suggestDeviceContacts: Boolean = false,
    /** Light phone: only approved contacts can call and text. */
    val lightContactRestriction: Boolean = false,
    /** Null (also in cached rules without this field) keeps the previous contact policy. */
    val selfScheduleContacts: Boolean? = null,
    val changeReceiptsEnabled: Boolean = true,
    // Old servers reject unknown protection keys and do not advertise this feature.
    val healthBoardEnabled: Boolean = false,
    val allowServerMove: Boolean = false,
    val serverMove: ServerMoveInstruction? = null,
    /**
     * This server's provisioning DNS host. It answers for every ClientID, so it is the safe fallback
     * when the phone's own host stops answering. Null on old servers or when none is configured.
     */
    val fallbackDnsHost: String? = null,
    val pushProvider: String = "none",
    val unifiedPushAvailable: Boolean = false,
    val fcmValidationKey: String = "",
    val language: String? = null,
    val lockSystemLanguage: Boolean = true,
    /**
     * Bedtime is silent (docs/bedtime.md). Missing from older servers: on, the default.
     */
    val silentBedtime: Boolean = true,
    /**
     * A parent next to the child may approve a request on the phone with the parent PIN. Old servers
     * have no endpoint for it, so missing means off.
     */
    val pinApproval: Boolean = false,
    /**
     * The server keeps this phone's daily use for the parents' weekly summary (docs/weekly-summary.md).
     * The phone only tells the child so on "What can my parents see?". Old servers send nothing: off.
     */
    val weeklySummaryEnabled: Boolean = false,
    val appUpdates: AppUpdateRules = AppUpdateRules(),
    /** Modes on one weekly schedule (docs/modes.md); null while they are off or from older servers. */
    val modes: ModesRules? = null,
) {
    companion object {
        /** 10 s only while a ring or an "Are you okay?" is open; the server sends 60 otherwise. */
        const val MIN_POLL_SECONDS = 10
        const val LOCATION_OFF = "off"
        const val LOCATION_FIND = "find"
        const val LOCATION_CHECKIN = "checkin"
        const val LOCATION_ALWAYS = "always"
        private val LOCATION_MODES = setOf(LOCATION_OFF, LOCATION_FIND, LOCATION_CHECKIN, LOCATION_ALWAYS)
        const val DEFAULT_POLL_SECONDS = 60

        /**
         * Parses the document. Throws on anything malformed, so a broken answer is never
         * applied: the phone keeps its last good rules instead.
         */
        fun parse(text: String): ServerRules {
            val j = JSONObject(text)
            val apps = j.getJSONObject("apps")
            val dns = j.getJSONObject("dns")
            val location = j.getJSONObject("location")
            val host = dns.optString("host", "").trim().lowercase().takeIf { PolicyConfig.isValidHost(it) }
            return ServerRules(
                phoneId = j.getString("phoneId"),
                language = PhoneLanguage.supportedTag(j.optString("language", "")),
                lockSystemLanguage = j.optBoolean("lockSystemLanguage", true),
                silentBedtime = j.optBoolean("silentBedtime", true),
                pinApproval = j.optBoolean("pinApprovalEnabled", false),
                weeklySummaryEnabled = j.optBoolean("weeklySummaryEnabled", false),
                appUpdates = AppUpdateRules.parse(j.optJSONObject("appUpdates")),
                modes = ModesRules.parse(j),
                allowServerMove = j.optBoolean("allowServerMove", false),
                serverMove = j.optJSONObject("move")?.let {
                    ServerMoveInstruction.parse(it.optString("serverUrl"), it.optString("token"))
                },
                fallbackDnsHost = j.optString("fallbackDnsHost", "").trim().lowercase().takeIf { PolicyConfig.isValidHost(it) },
                profile = j.getString("profile").also { require(it == "child" || it == "self") { "unknown profile $it" } },
                timezone = ZoneId.of(j.getString("timezone")),
                changeReceiptsEnabled = j.optBoolean("changeReceiptsEnabled", true),
                healthBoardEnabled = j.optBoolean("healthBoardEnabled", false),
                suggestDeviceContacts = j.optBoolean("suggestDeviceContacts", false),
                lightContactRestriction = j.optBoolean("lightContactRestriction", false),
                pushProvider = j.optString("pushProvider", "none"),
                unifiedPushAvailable = j.optBoolean("unifiedPushAvailable"),
                fcmValidationKey = j.optString("fcmValidationKey"),
                selfScheduleContacts = if (j.isNull("selfScheduleContacts")) null else j.getBoolean("selfScheduleContacts"),
                allowedApps = strings(apps.getJSONArray("allowed")),
                hiddenApps = strings(apps.getJSONArray("hidden")),
                openApps = apps.optBoolean("open", false),
                blockedApps = apps.optJSONArray("blocked")?.let(::strings).orEmpty(),
                contacts = objects(j.getJSONArray("contacts")).map {
                    ApprovedContact(it.getString("name"), it.getString("number"))
                },
                schedules = objects(j.getJSONArray("schedules")).map(::schedule),
                dnsHost = host,
                filterMethod = FilterMethod.fromWire(dns.optString("filterMethod")),
                // Old servers did not send "ready": then the host is not trusted yet.
                dnsReady = host != null && dns.optBoolean("ready", false),
                privateDnsReady = host != null && dns.optBoolean("privateDnsReady", false),
                locationEnabled = location.getBoolean("enabled"),
                locationIntervalMinutes = location.optInt("intervalMinutes", 5).coerceIn(1, 24 * 60),
                locateRequestedAt = location.optString("requestedAt", "")
                    .takeIf { it.isNotEmpty() && it != "null" }
                    ?.let { Instant.parse(it) },
                pollSeconds = j.optInt("pollSeconds", DEFAULT_POLL_SECONDS).coerceIn(MIN_POLL_SECONDS, 24 * 60 * 60),
                // Old servers do not send it. Only decimal IDs: FRP takes nothing else.
                frpAccountIds = j.optJSONObject("resetProtection")?.optJSONArray("accountIds")
                    ?.let(::strings)?.filter { id -> id.isNotEmpty() && id.length <= 30 && id.all(Char::isDigit) }?.toSet()
                    .orEmpty(),
                settings = PhoneSettings.parse(j.optJSONObject("settings")),
                home = HomePrefs.parse(j.optJSONObject("home")),
                // Older servers do not send "update".
                updateRequestedAt = j.optJSONObject("update")?.optString("requestedAt", "")
                    ?.takeIf { it.isNotEmpty() && it != "null" }
                    ?.let { Instant.parse(it) },
                // Both are newer than the first servers: missing means none.
                toInstall = apps.optJSONArray("toInstall")?.let(::objects).orEmpty().map {
                    CatalogInstall(it.getString("packageName"), if (it.isNull("label")) it.getString("packageName") else it.getString("label"))
                },
                timeLimits = j.optJSONObject("timeLimits")?.let(TimeLimits::parse) ?: TimeLimits.NONE,
                release = j.optBoolean("release", false),
                supportEnabled = j.optBoolean("supportEnabled", true),
                releaseWarningsEnabled = j.optBoolean("releaseWarningsEnabled", true),
                askMoreTimeEnabled = j.optBoolean("askMoreTimeEnabled", true),
                limitWarningEnabled = j.optBoolean("limitWarningEnabled", true),
                locationMode = locationMode(location),
                sos = j.optJSONObject("sos")?.let { sos ->
                    val parents = sos.getJSONArray("parents")
                    SosRules(sos.getString("name"), List(parents.length()) { i ->
                        val contact = parents.getJSONObject(i)
                        ApprovedContact(contact.getString("name"), contact.getString("number"))
                    }, HiddenSos.parse(sos.optJSONObject("hidden")), QuickMessages.parse(sos.optJSONObject("quickMessages")))
                },
                inbox = InboxRules.parse(j.optJSONObject("inbox")),
                locationAlwaysUntil = location.optString("alwaysUntil", "")
                    .takeIf { it.isNotEmpty() && it != "null" }
                    ?.let { runCatching { Instant.parse(it) }.getOrNull() },
                ring = j.optJSONObject("ring")?.let {
                    RingRequest(
                        id = it.getString("id"),
                        endsAt = Instant.parse(it.getString("endsAt")),
                        stopOnAnswer = it.optBoolean("stopOnAnswer", true),
                        answered = it.optBoolean("answered", false),
                    )
                },
                checkIn = j.optJSONObject("checkIn")?.let {
                    CheckInRequest(
                        id = it.getString("id"),
                        deadline = Instant.parse(it.getString("deadline")),
                        callNumber = if (it.isNull("callNumber")) null else it.optString("callNumber").takeIf(String::isNotBlank),
                        sendLocation = it.optBoolean("sendLocation", false),
                        createdAt = it.optString("createdAt").takeIf(String::isNotBlank)?.let(Instant::parse),
                        locationDue = if (it.has("locationDue")) it.getBoolean("locationDue") else null,
                    )
                },
            )
        }

        /**
         * Servers from before the modes only say enabled: then every 5 minutes, as before. A mode
         * this app does not know yet is read as "only when asked", never as more sharing.
         */
        private fun locationMode(location: JSONObject): String {
            val enabled = location.getBoolean("enabled")
            if (!location.has("mode")) return if (enabled) LOCATION_ALWAYS else LOCATION_OFF
            val mode = location.getString("mode")
            return when {
                !enabled -> LOCATION_OFF
                mode in LOCATION_MODES -> mode
                else -> LOCATION_FIND
            }
        }

        private fun schedule(o: JSONObject): Schedule {
            val days = (0 until o.getJSONArray("days").length()).map { o.getJSONArray("days").getInt(it) }.toSet()
            require(days.isNotEmpty() && days.all { it in 1..7 }) { "bad schedule days $days" }
            return Schedule(
                id = o.getString("id"),
                kind = o.getString("kind"),
                days = days,
                start = LocalTime.parse(o.getString("start")),
                end = LocalTime.parse(o.getString("end")),
                allowedPackages = strings(o.getJSONArray("allowedPackages")),
            )
        }

        internal fun strings(a: JSONArray): Set<String> = (0 until a.length()).map { a.getString(it) }.toSet()
        internal fun objects(a: JSONArray): List<JSONObject> = (0 until a.length()).map { a.getJSONObject(it) }
    }
}

/**
 * A weekly school-time or bedtime window. [days] are ISO weekdays (1 = Monday) on which the
 * window STARTS; when [end] is before [start] the window runs past midnight into the next day.
 */
data class Schedule(
    val id: String,
    val kind: String,
    val days: Set<Int>,
    val start: LocalTime,
    val end: LocalTime,
    val allowedPackages: Set<String>,
)

/** A catalog app the parent approved before it was installed. */
data class CatalogInstall(val packageName: String, val label: String)

/** "Ring the phone": alarm sound and vibration until [endsAt], or until "I'm here" when [stopOnAnswer]. */
data class RingRequest(val id: String, val endsAt: Instant, val stopOnAnswer: Boolean, val answered: Boolean)

/** "Are you okay?": shown until answered or [deadline]; then one position if [sendLocation]. */
data class CheckInRequest(
    val id: String,
    val deadline: Instant,
    val callNumber: String?,
    val sendLocation: Boolean,
    val createdAt: Instant? = null,
    val locationDue: Boolean? = null,
)

/** [hidden] and [quickMessages] live in SosExtras.kt; older servers send neither (off, none). */
data class SosRules(
    val name: String,
    val parents: List<ApprovedContact>,
    val hidden: HiddenSos = HiddenSos.OFF,
    val quickMessages: QuickMessages = QuickMessages.NONE,
)

/**
 * App updates in strong mode (docs/policies.md, "App updates"). Old servers send nothing: the
 * nightly window stays on, which keeps approved apps patched.
 */
data class AppUpdateRules(
    /** "Update approved apps automatically": the nightly window. */
    val automatic: Boolean = true,
    /** Set when a parent pressed "Update apps now". */
    val requestedAt: Instant? = null,
    /** The last window the server recorded. */
    val reportedWindow: String? = null,
    /** The new apps the server has made requests of; from then on its rules decide about them. */
    val recordedApps: Set<String> = emptySet(),
) {
    companion object {
        fun parse(j: JSONObject?): AppUpdateRules = if (j == null) AppUpdateRules() else AppUpdateRules(
            automatic = j.optBoolean("automatic", true),
            requestedAt = j.optString("requestedAt", "").takeIf { it.isNotEmpty() && it != "null" }?.let(Instant::parse),
            reportedWindow = j.optString("reportedWindow", "").takeIf { it.isNotEmpty() && it != "null" },
            recordedApps = j.optJSONArray("recordedApps")?.let { a -> List(a.length()) { a.getString(it) }.toSet() }.orEmpty(),
        )
    }
}
