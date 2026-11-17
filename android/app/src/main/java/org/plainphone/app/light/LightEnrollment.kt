// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.content.Context
import android.net.Uri
import org.plainphone.app.sync.PairingController
import org.plainphone.app.sync.SyncStore
import java.net.URI

/** Parse browser links without trusting them to configure the phone. */
internal object LightEnrollment {
    class Link(val token: String, val server: String)

    fun parse(uri: Uri?): Link? {
        if (uri?.scheme != "plainphone" || uri.authority != "setup" || !uri.path.isNullOrEmpty()) return null
        val token = uri.getQueryParameter("token")?.takeIf { it.matches(Regex("pp_e_[A-Za-z0-9_-]{22}")) } ?: return null
        val server = uri.getQueryParameter("server") ?: return null
        val origin = runCatching { URI(server) }.getOrNull() ?: return null
        if (origin.scheme != "https" || origin.host == null || origin.userInfo != null ||
            !origin.rawPath.isNullOrEmpty() || origin.rawQuery != null || origin.rawFragment != null
        ) return null
        return Link(token, server)
    }

    fun canImport(context: Context, sync: SyncStore = SyncStore(context)): Boolean =
        Mode.isLight(context) && !LightSetup.isComplete(context) && !sync.everPaired

    /** Called only after the parent confirms the new PIN on the phone. */
    fun accept(context: Context, link: Link, pin: String, repeatedPin: String, sync: SyncStore = SyncStore(context)): Boolean =
        synchronized(PairingController.enrollmentLock) {
            if (!canImport(context, sync) || !pin.matches(Regex("[0-9]{6,12}")) || pin != repeatedPin) {
                return@synchronized false
            }
            LightSetup.savePin(context, pin, link.server)
            LightSetup.markDashboardPin(context)
            sync.saveEnrollToken(link.token)
            true
        }
}
