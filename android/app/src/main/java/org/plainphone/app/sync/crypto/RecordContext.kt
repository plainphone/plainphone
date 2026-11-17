// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync.crypto

import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive

data class SelfBase(val version: Long, val digest: String, val epoch: Long)

fun rulesRejection(header: JsonObject, role: String, acceptedVersion: Long): String? {
    if (header["table"] != JsonPrimitive("phone_state") || header["scope"] != JsonPrimitive("R")) return "wrong-scope"
    if (role != "admin") return "wrong-role"
    val version = header["version"] as? JsonPrimitive
    if (version == null || !version.isNumber) return "old-version"
    val revision = runCatching { WireEncoding.parseInteger(version.asString) }.getOrNull()
    return if (revision == null || revision < 1 || revision < acceptedVersion) "old-version" else null
}

fun selfBaseRejection(changeId: String, expected: SelfBase, accepted: SelfBase, consumed: Set<String>): String? = when {
    changeId in consumed -> "replay"
    expected.epoch != accepted.epoch -> "wrong-epoch"
    expected.version != accepted.version -> "wrong-base-version"
    expected.digest != accepted.digest -> "wrong-base-digest"
    else -> null
}

/** Scope grants and owner principal IDs must have been derived from an accepted roster. */
fun hasSelfScope(phoneId: String, ownerPrincipalId: String, principalId: String, selfPhoneIds: List<String>): Boolean =
    principalId == ownerPrincipalId || phoneId in selfPhoneIds
