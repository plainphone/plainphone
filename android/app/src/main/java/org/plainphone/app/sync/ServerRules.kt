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
    /** Apps the parent picked from the catalog that are not installed yet. Treated as allowed. */
    val toInstall: List<CatalogInstall> = emptyList(),
    /** Daily minutes per app and in total (docs/time-limits.md). */
    val timeLimits: TimeLimits = TimeLimits.NONE,
) {
    companion object {
        const val MIN_POLL_SECONDS = 30
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
                // Both are newer than the first servers: missing means none.
                toInstall = apps.optJSONArray("toInstall")?.let(::objects).orEmpty().map {
                    CatalogInstall(it.getString("packageName"), if (it.isNull("label")) it.getString("packageName") else it.getString("label"))
                },
                timeLimits = j.optJSONObject("timeLimits")?.let(TimeLimits::parse) ?: TimeLimits.NONE,
            )
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
