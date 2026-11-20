// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.unit.sp
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.Lock
import org.plainphone.app.PolicyConfig
import org.plainphone.app.R
import org.plainphone.app.light.CalmScreen
import org.plainphone.app.light.Mode
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.ui.PlainphoneTheme

/**
 * What the child sees when something tries to open Play (an app's "Update now" button, a
 * `market://` link) while Play is hidden in strong mode: instead of nothing happening, a plain
 * explanation that apps update by themselves and how to get a new one (issue #168).
 *
 * The activity only answers `market://` links while Play is hidden, so it never competes with
 * Play: [sync] switches it on and off after every policy run.
 */
class PlayExplanationActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            PlainphoneTheme {
                PlayExplanationScreen(automatic = AppUpdateWindow.automatic(this), onClose = { finish() })
            }
        }
    }
}

@Composable
fun PlayExplanationScreen(automatic: Boolean, onClose: () -> Unit) {
    CalmScreen(
        eyebrow = stringResource(R.string.app_name),
        title = stringResource(R.string.play_explain_title),
        body = stringResource(if (automatic) R.string.play_explain_automatic else R.string.play_explain_manual),
        primary = stringResource(android.R.string.ok),
        onPrimary = onClose,
    ) {
        Text(stringResource(R.string.play_explain_new_app), fontSize = 17.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

object PlayExplanation {
    /** Strong mode with Play hidden: answer Play links with the explanation. Otherwise stay out of the way. */
    fun sync(context: Context) {
        val app = context.applicationContext
        val sync = SyncStore(app)
        val wanted = runCatching {
            val device = AndroidDeviceControls(app)
            Mode.isStrong(app) && device.isDeviceOwner() && !Lock.isInMaintenanceWindow(app) &&
                !sync.released && !sync.releaseAsked &&
                (!device.isInstalled(PolicyConfig.PLAY_STORE) || device.isHidden(PolicyConfig.PLAY_STORE))
        }.getOrDefault(false)
        val state = if (wanted) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        val component = ComponentName(app, PlayExplanationActivity::class.java)
        if (app.packageManager.getComponentEnabledSetting(component) != state) {
            app.packageManager.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP)
        }
    }

    fun intent(context: Context) = Intent(context, PlayExplanationActivity::class.java)
}
