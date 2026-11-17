// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync.crypto

import com.google.gson.JsonObject
import com.google.gson.JsonPrimitive

data class SelfBase(val version: Long, val digest: String, val epoch: Long)

data class RulesRevision(val version: Long, val digest: String)

fun rulesRejection(header: JsonObject, role: String, receivedDigest: String, accepted: RulesRevision?): String? {
    if (header["table"] != JsonPrimitive("phone_state") || header["scope"] != JsonPrimitive("R")) return "wrong-scope"
    if (role != "admin") return "wrong-role"
    val version = header["version"] as? JsonPrimitive
    if (version == null || !version.isNumber) return "old-version"
    val revision = runCatching { WireEncoding.parseInteger(version.asString) }.getOrNull()
    if (revision == null || revision < 1 || (accepted != null && revision < accepted.version)) return "old-version"
    if (accepted != null && revision == accepted.version && receivedDigest != accepted.digest) return "revision-conflict"
    return null
}

fun selfBaseRejection(changeId: String, expected: SelfBase, accepted: SelfBase, consumed: Set<String>): String? = when {
    changeId in consumed -> "replay"
    expected.epoch != accepted.epoch -> "wrong-epoch"
    expected.version != accepted.version -> "wrong-base-version"
    expected.digest != accepted.digest -> "wrong-base-digest"
    else -> null
}

/** Use the device grants from the accepted roster, including the grant at Self phone creation. */
fun hasSelfScope(phoneId: String, selfPhoneIds: List<String>): Boolean =
    phoneId in selfPhoneIds
