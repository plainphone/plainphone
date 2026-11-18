// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.provisioning

import android.annotation.SuppressLint
import android.content.Context
import org.plainphone.app.Lock
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.Mode
import org.plainphone.app.sync.SyncStore

internal object StrongSetup {
    private fun prefs(context: Context) = context.getSharedPreferences("plainphone_strong_setup", Context.MODE_PRIVATE)

    @SuppressLint("ApplySharedPref") // Keep this requirement even if pairing is cancelled or Android kills provisioning.
    fun requireAccount(context: Context) {
        prefs(context).edit().putBoolean("require_account", true).commit()
    }

    fun needsAccount(context: Context, sync: SyncStore = SyncStore(context)): Boolean =
        (prefs(context).getBoolean("require_account", false) || sync.enrollToken() != null) &&
            (!LightSetup.hasDashboardRules(sync) || sync.rules()?.phoneId != sync.phoneId)

    fun needsConfirmation(context: Context): Boolean =
        Mode.isStrong(context) && Lock.firstAppliedAtMs(context) == null &&
            (LightSetup.profile(context) == null || needsAccount(context))
}
