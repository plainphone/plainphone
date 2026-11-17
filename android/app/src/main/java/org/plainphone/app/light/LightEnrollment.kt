// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.content.Context
import android.net.Uri
import org.plainphone.app.ConfigStore
import org.plainphone.app.MaintenancePin
import org.plainphone.app.sync.SyncStore
import java.net.URI

/** Parse browser links without trusting them to configure the phone. */
internal object LightEnrollment {
    class Link(val token: String, val hash: String, val salt: String, val server: String)

    fun parse(uri: Uri?): Link? {
        if (uri?.scheme != "plainphone" || uri.authority != "setup" || !uri.path.isNullOrEmpty()) return null
        val token = uri.getQueryParameter("token")?.takeIf { it.matches(Regex("pp_e_[A-Za-z0-9_-]{22}")) } ?: return null
        val hash = uri.getQueryParameter("pinHash")?.takeIf { it.matches(Regex("[0-9a-f]{64}")) } ?: return null
        val salt = uri.getQueryParameter("pinSalt")?.takeIf { it.matches(Regex("[0-9a-f]{32}")) } ?: return null
        val server = uri.getQueryParameter("server") ?: return null
        val origin = runCatching { URI(server) }.getOrNull() ?: return null
        if (origin.scheme != "https" || origin.host == null || origin.userInfo != null ||
            !origin.rawPath.isNullOrEmpty() || origin.rawQuery != null || origin.rawFragment != null
        ) return null
        return Link(token, hash, salt, server)
    }

    fun canImport(context: Context, sync: SyncStore = SyncStore(context)): Boolean =
        Mode.isLight(context) && !LightSetup.isComplete(context) && !sync.everPaired && sync.enrollToken() == null

    /** Called only from the confirmation screen after the parent enters their dashboard PIN. */
    fun accept(context: Context, link: Link, pin: String, sync: SyncStore = SyncStore(context)): Boolean {
        if (pin.length !in 6..12 || !canImport(context, sync)) return false
        val config = ConfigStore(context)
        val current = config.load()
        val incoming = current.copy(pinHashHex = link.hash, pinSaltHex = link.salt, serverUrl = link.server)
        if (!MaintenancePin.verify(pin, incoming) ||
            (!current.usesDefaultPin && !MaintenancePin.verify(pin, current))
        ) return false

        config.save(incoming)
        LightSetup.markDashboardPin(context)
        sync.saveEnrollToken(link.token)
        return true
    }
}
