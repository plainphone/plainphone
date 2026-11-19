// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import java.time.Instant
import java.time.LocalDate
import org.json.JSONObject

/**
 * An ask for more time as the server knows it (`/device/more-time-requests`, server/openapi.yaml).
 * [packageName] is [TimeLimits.TOTAL] for the daily cap. [day] is the phone's local date.
 */
data class MoreTimeRequest(
    val id: String,
    val packageName: String,
    val reason: String?,
    val day: LocalDate,
    val status: Status,
    /** "15", "60", "day" or "no"; null while nobody answered. */
    val answer: String?,
    /** For "day": the minutes that were left until midnight when the parent answered. */
    val grantedMinutes: Int?,
    val createdAt: Instant,
    val decidedAt: Instant?,
) {
    enum class Status(val wire: String) {
        PENDING("pending"), APPROVED("approved"), DECLINED("declined"), EXPIRED("expired");

        companion object {
            fun fromWire(value: String): Status = entries.firstOrNull { it.wire == value }
                ?: throw IllegalArgumentException("unknown more-time status $value")
        }
    }

    companion object {
        /** Throws on anything malformed, like [ServerRules.parse]. */
        fun parse(j: JSONObject): MoreTimeRequest = MoreTimeRequest(
            id = j.getString("id"),
            packageName = j.getString("packageName"),
            reason = if (j.isNull("reason")) null else j.getString("reason"),
            day = LocalDate.parse(j.getString("day")),
            status = Status.fromWire(j.getString("status")),
            answer = if (j.isNull("answer")) null else j.getString("answer"),
            grantedMinutes = if (j.isNull("grantedMinutes")) null else j.getInt("grantedMinutes"),
            createdAt = Instant.parse(j.getString("createdAt")),
            decidedAt = if (j.isNull("decidedAt")) null else Instant.parse(j.getString("decidedAt")),
        )

        fun parseList(body: String): List<MoreTimeRequest> =
            ServerRules.objects(JSONObject(body).getJSONArray("requests")).map(::parse)
    }
}
