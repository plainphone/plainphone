// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

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
    /** When to send a position: off, find, checkin or always (docs/location.md). */
    val locationMode: String = if (locationEnabled) LOCATION_ALWAYS else LOCATION_OFF,
    /** When "always" ends by itself (the server falls back to "checkin"); null otherwise. */
    val locationAlwaysUntil: Instant? = null,
    /** An open "Ring the phone"; null means stop. */
    val ring: RingRequest? = null,
    /** An open "Are you okay?"; null means close it. */
    val checkIn: CheckInRequest? = null,
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
                profile = j.getString("profile").also { require(it == "child" || it == "self") { "unknown profile $it" } },
                timezone = ZoneId.of(j.getString("timezone")),
                allowedApps = strings(apps.getJSONArray("allowed")),
                hiddenApps = strings(apps.getJSONArray("hidden")),
                contacts = objects(j.getJSONArray("contacts")).map {
                    ApprovedContact(it.getString("name"), it.getString("number"))
                },
                schedules = objects(j.getJSONArray("schedules")).map(::schedule),
                dnsHost = host,
                // Old servers did not send "ready": then the host is not trusted yet.
                dnsReady = host != null && dns.optBoolean("ready", false),
                locationEnabled = location.getBoolean("enabled"),
                locationIntervalMinutes = location.optInt("intervalMinutes", 5).coerceIn(1, 24 * 60),
                locateRequestedAt = location.optString("requestedAt", "")
                    .takeIf { it.isNotEmpty() && it != "null" }
                    ?.let { Instant.parse(it) },
                pollSeconds = j.optInt("pollSeconds", DEFAULT_POLL_SECONDS).coerceIn(MIN_POLL_SECONDS, 24 * 60 * 60),
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
                locationMode = locationMode(location),
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
data class CheckInRequest(val id: String, val deadline: Instant, val callNumber: String?, val sendLocation: Boolean)
