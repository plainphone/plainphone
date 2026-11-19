// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.requests

import org.json.JSONObject
import org.plainphone.app.sync.MoreTimeRequest
import org.plainphone.app.sync.TimeLimits

/**
 * Something the person with the phone asked for (an app, a contact or more time), as `GET /device/requests`
 * lists it (docs/sync-api.md). Every screen shows the same states, whoever answered.
 */
data class PhoneRequest(
    val id: String,
    val kind: Kind,
    val packageName: String?,
    val name: String?,
    val number: String?,
    val status: Status,
    /** "phone" when a parent approved it on the phone itself with the parent PIN. */
    val decidedVia: String?,
    /** Approved on a Self phone, but the change still waits for the key. */
    val waitingForKey: Boolean,
) {
    enum class Kind { APP, CONTACT, MORE_TIME }
    enum class Status { PENDING, APPROVED, REJECTED }

    val pending: Boolean get() = status == Status.PENDING
    val approvedOnPhone: Boolean get() = status == Status.APPROVED && decidedVia == "phone"

    companion object {
        /**
         * A request for more time, shown with the others. Null for one nobody answered in time:
         * it can no longer be answered, so the screen has nothing to offer for it.
         * [packageName] is "*" for the daily cap.
         */
        fun fromMoreTime(r: MoreTimeRequest): PhoneRequest? = PhoneRequest(
            id = r.id,
            kind = Kind.MORE_TIME,
            packageName = r.packageName.takeIf { it != TimeLimits.TOTAL },
            name = null,
            number = null,
            status = when (r.status) {
                MoreTimeRequest.Status.PENDING -> Status.PENDING
                MoreTimeRequest.Status.APPROVED -> Status.APPROVED
                MoreTimeRequest.Status.DECLINED -> Status.REJECTED
                MoreTimeRequest.Status.EXPIRED -> return null
            },
            decidedVia = r.decidedVia,
            waitingForKey = false,
        )

        /** Throws on anything malformed, so a broken answer is never shown as an empty list. */
        fun parse(o: JSONObject): PhoneRequest = PhoneRequest(
            id = o.getString("id"),
            kind = when (val kind = o.getString("kind")) {
                "app" -> Kind.APP
                "contact" -> Kind.CONTACT
                else -> throw IllegalArgumentException("unknown request kind $kind")
            },
            packageName = o.optString("packageName", "").takeIf { it.isNotEmpty() && !o.isNull("packageName") },
            name = o.optString("name", "").takeIf { it.isNotEmpty() && !o.isNull("name") },
            number = o.optString("number", "").takeIf { it.isNotEmpty() && !o.isNull("number") },
            status = when (val status = o.getString("status")) {
                "pending" -> Status.PENDING
                "approved" -> Status.APPROVED
                "rejected" -> Status.REJECTED
                else -> throw IllegalArgumentException("unknown request status $status")
            },
            decidedVia = o.optString("decidedVia", "").takeIf { it.isNotEmpty() && !o.isNull("decidedVia") },
            waitingForKey = o.optBoolean("waitingForKey", false),
        )

        fun parseList(text: String): List<PhoneRequest> {
            val list = JSONObject(text).getJSONArray("requests")
            return List(list.length()) { parse(list.getJSONObject(it)) }
        }
    }
}
