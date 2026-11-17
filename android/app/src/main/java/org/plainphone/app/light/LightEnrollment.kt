// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.content.Context
import android.net.Uri
import org.plainphone.app.ConfigStore
import org.plainphone.app.sync.SyncStore
import java.net.URI

/** Browser handoff after APK installation. A setup link cannot change a protected phone. */
object LightEnrollment {
    internal fun accept(context: Context, uri: Uri?, sync: SyncStore = SyncStore(context)) {
        if (uri?.scheme != "plainphone" || uri.authority != "setup" || !uri.path.isNullOrEmpty()) return
        if (!Mode.isLight(context) || LightSetup.isComplete(context)) return
        if (sync.everPaired || sync.enrollToken() != null) return
        val config = ConfigStore(context)
        val current = config.load()
        if (!current.usesDefaultPin && !LightSetup.hasDashboardPin(context)) return

        val token = uri.getQueryParameter("token")?.takeIf { it.matches(Regex("pp_e_[A-Za-z0-9_-]{22}")) } ?: return
        val hash = uri.getQueryParameter("pinHash")?.takeIf { it.matches(Regex("[0-9a-f]{64}")) } ?: return
        val salt = uri.getQueryParameter("pinSalt")?.takeIf { it.matches(Regex("[0-9a-f]{32}")) } ?: return
        val server = uri.getQueryParameter("server") ?: return
        val origin = runCatching { URI(server) }.getOrNull() ?: return
        if (origin.scheme != "https" || origin.host == null || origin.userInfo != null ||
            !origin.rawPath.isNullOrEmpty() || origin.rawQuery != null || origin.rawFragment != null
        ) return

        LightSetup.markDashboardPin(context)
        config.save(current.copy(pinHashHex = hash, pinSaltHex = salt, serverUrl = server))
        sync.saveEnrollToken(token)
    }
}
