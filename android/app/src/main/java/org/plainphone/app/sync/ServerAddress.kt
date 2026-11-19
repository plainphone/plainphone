// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sync

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.util.Locale
import org.json.JSONObject

/** Runtime server selection uses an origin. Provisioning keeps its existing URL format. */
internal object ServerAddress {
    fun normalize(input: String, debug: Boolean): String? {
        val uri = runCatching { URI(input.trim()) }.getOrNull() ?: return null
        val scheme = uri.scheme?.lowercase(Locale.ROOT) ?: return null
        val host = uri.host?.lowercase(Locale.ROOT) ?: return null
        if (uri.rawUserInfo != null || uri.rawQuery != null || uri.rawFragment != null ||
            (uri.rawPath != "" && uri.rawPath != "/") || uri.port == 0 || uri.port > 65535
        ) return null
        if (scheme != "https" && !(scheme == "http" && debug && isLocal(host))) return null
        val port = uri.port.takeUnless { it == -1 || (scheme == "https" && it == 443) || (scheme == "http" && it == 80) }
        return "$scheme://$host" + (port?.let { ":$it" } ?: "")
    }

    private fun isLocal(host: String): Boolean {
        if (host == "localhost" || host == "[::1]" || host.endsWith(".local")) return true
        val ip = host.split('.').map { it.toIntOrNull() ?: return false }
        if (ip.size != 4 || ip.any { it !in 0..255 }) return false
        return ip[0] == 127 || ip[0] == 10 || (ip[0] == 192 && ip[1] == 168) || (ip[0] == 172 && ip[1] in 16..31)
    }

    fun check(server: String) {
        val connection = URI("$server/api/health").toURL().openConnection() as HttpURLConnection
        try {
            connection.instanceFollowRedirects = false
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            if (connection.responseCode != 200) throw IOException("Server unavailable")
            val health = connection.inputStream.bufferedReader(Charsets.UTF_8).use {
                val chars = CharArray(4096)
                val length = it.readBlock(chars)
                if (length == chars.size) throw IOException("Invalid health response")
                JSONObject(String(chars, 0, length))
            }
            val compatibility = health.opt("compatibility")
            if (health.opt("ok") != true || compatibility !is Number || compatibility.toDouble() != 1.0) {
                throw IOException("Incompatible server")
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun java.io.Reader.readBlock(chars: CharArray): Int {
        var offset = 0
        while (offset < chars.size) {
            val count = read(chars, offset, chars.size - offset)
            if (count < 0) break
            offset += count
        }
        return offset
    }
}
