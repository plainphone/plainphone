// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync

import java.io.IOException
import java.security.MessageDigest
import java.util.Base64
import org.json.JSONObject
import org.plainphone.app.light.vpn.DotFraming
import org.plainphone.app.light.vpn.TlsConnector

class ServerMoveInstruction private constructor(val serverUrl: String, val token: String) {
    companion object {
        internal fun parse(url: String, token: String): ServerMoveInstruction? {
            val origin = ServerAddress.normalize(url, debug = false) ?: return null
            if (!Regex("pp_m_[A-Za-z0-9_-]{43}").matches(token)) return null
            return ServerMoveInstruction(origin, token)
        }
    }
}

interface MoveApi {
    fun redeemMove(token: String, deviceToken: String)
    fun moveRules(deviceToken: String): RulesResult.Changed
}

internal class ServerMove(
    private val store: SyncStore,
    private val destination: (String) -> MoveApi,
    private val checkDns: (String) -> Unit,
) {
    fun attempt(oldToken: String, instruction: ServerMoveInstruction, now: Long, sourceStillOffersMove: () -> Boolean): Boolean {
        val oldRules = store.rawRules() ?: return false
        // Stable across retries, including process death after redemption. The old
        // device credential stays on the phone. The new server receives only the new one.
        val secret = MessageDigest.getInstance("SHA-256")
            .digest("plainphone-move-v1:${instruction.token}:$oldToken".toByteArray(Charsets.UTF_8))
        val token = "pp_d_" + Base64.getUrlEncoder().withoutPadding().encodeToString(secret)
        val api = destination(instruction.serverUrl)
        api.redeemMove(instruction.token, token)
        val response = api.moveRules(token)
        val rules = ServerRules.parse(response.body)
        if (rules.release || !rules.dnsReady || !sameProtection(oldRules, response.body)) return false
        checkDns(requireNotNull(rules.dnsHost))
        // Last check before the commit. A parent who turns moving off on the old server in the few
        // milliseconds after this still sees the move complete. That is accepted: the phone only
        // moves into protection rules verified identical above (including the filter method; the
        // fallback DNS host and the move switch itself are not compared), so it is no less
        // protected, and it stays on the old server until this call returns. See docs/self-hosting.md.
        if (!sourceStillOffersMove()) return false
        return store.saveMoved(oldToken, instruction.serverUrl, token, response, now)
    }

    private fun sameProtection(before: String, after: String): Boolean {
        val previous = ServerRules.parse(before)
        val next = ServerRules.parse(after)
        if (!next.frpAccountIds.containsAll(previous.frpAccountIds)) return false
        val a = JSONObject(before)
        val b = JSONObject(after)
        // Server-local identifiers and transient requests do not travel with a policy.
        for (doc in listOf(a, b)) {
            doc.getJSONObject("location").remove("requestedAt")
            doc.getJSONObject("dns").remove("host")
            doc.getJSONObject("dns").remove("ready")
            doc.getJSONObject("dns").remove("privateDnsReady")
            val schedules = doc.getJSONArray("schedules")
            for (i in 0 until schedules.length()) schedules.getJSONObject(i).remove("id")
        }
        return listOf("profile", "mode", "timezone", "apps", "timeLimits", "contacts", "schedules", "dns",
            "location", "settings", "home", "suggestDeviceContacts", "lightContactRestriction", "selfScheduleContacts")
            .all { key -> a.get(key).toString() == b.get(key).toString() }
    }
}

internal fun checkMoveDns(host: String) {
    val id = java.security.SecureRandom().nextInt(65_536)
    // Query a known name with an ordinary A request. A valid blocked reply may
    // be NXDOMAIN, but a refusing or unavailable resolver cannot take over.
    val query = byteArrayOf((id shr 8).toByte(), id.toByte(), 1, 0, 0, 1, 0, 0, 0, 0, 0, 0,
        7, 101, 120, 97, 109, 112, 108, 101, 3, 99, 111, 109, 0, 0, 1, 0, 1)
    TlsConnector(host).connect(5_000).use { connection ->
        connection.setTimeout(5_000)
        DotFraming.write(connection.output, query)
        val answer = DotFraming.read(connection.input)
        if (answer.size < 12 || answer[0] != query[0] || answer[1] != query[1] ||
            (answer[2].toInt() and 0x80) == 0 || (answer[3].toInt() and 0x0f) !in setOf(0, 3)
        ) throw IOException("destination filter did not answer")
    }
}
