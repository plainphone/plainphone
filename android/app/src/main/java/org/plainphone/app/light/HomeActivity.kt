// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.app.role.RoleManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.util.concurrent.Executors
import org.plainphone.app.Compat
import org.plainphone.app.ConfigStore
import org.plainphone.app.Lock
import org.plainphone.app.MainActivity
import org.plainphone.app.MaintenanceActivity
import org.plainphone.app.R
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.home.HomeGuard
import org.plainphone.app.sync.CatalogInstall
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.TimeLimits
import org.plainphone.app.time.TimeGuard

/**
 * "Today": time left, apps the parent approved that can be installed, and (light mode) whether
 * the protection is whole. The first screen in light mode; in strong mode it opens from the
 * status screen when there is something to show.
 */
class HomeActivity : ComponentActivity() {
    private var refresh by mutableIntStateOf(0)
    private var taps = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            org.plainphone.app.ui.PlainphoneTheme {
                @Suppress("UNUSED_EXPRESSION") refresh
                Today()
            }
        }
    }

    override fun onResume() {
        super.onResume()
        taps = 0
        // A parent who entered the PIN keeps the window: applying here would end it (and relock).
        if (Lock.isInMaintenanceWindow(this)) {
            refresh++
        } else {
            Lock.applyAsync(this, "today opened") { runOnUiThread { refresh++ } }
        }
    }

    @Composable
    private fun Today() {
        val context = LocalContext.current
        val snapshot = TimeGuard.snapshot(context)
        val rules = SyncStore(context).rules()
        val light = Mode.isLight(context)
        val missing = if (light) {
            Protections.read(context, ConfigStore(context).load().dnsHost, snapshot != null).missingForLight()
        } else emptyList()
        // Strong mode: everything else is set by Device Owner; usage access only by the user.
        val needsUsage = !light && snapshot != null && !TimeGuard.hasUsageAccess(context)
        // Light mode cannot pin the home screen, so it offers Android's "choose home app" dialog.
        val offerHome = light && missing.isEmpty() && !needsUsage && canAskToBeHome(context)
        CalmScreen(
            eyebrow = stringResource(R.string.app_name),
            title = stringResource(R.string.today_title),
            body = when {
                needsUsage -> stringResource(R.string.light_step_usage_body)
                missing.isNotEmpty() -> stringResource(R.string.today_protection_missing)
                offerHome -> stringResource(R.string.home_make_default_body)
                snapshot == null -> stringResource(R.string.today_no_limits)
                else -> null
            },
            primary = when {
                needsUsage -> stringResource(R.string.light_step_usage_action)
                missing.isNotEmpty() -> stringResource(R.string.today_fix)
                offerHome -> stringResource(R.string.home_make_default_button)
                else -> null
            },
            onPrimary = {
                if (needsUsage) {
                    runCatching { startActivity(Intent(android.provider.Settings.ACTION_USAGE_ACCESS_SETTINGS)) }
                } else if (offerHome) {
                    askToBeHome()
                } else if (LightSetup.isComplete(context) && !Lock.isInMaintenanceWindow(context)) {
                    // Repairing is the parent's job, and the guard closes those screens outside the PIN window.
                    startActivity(Intent(context, org.plainphone.app.MaintenanceActivity::class.java))
                } else {
                    startActivity(LightSetupActivity.intent(context))
                }
            },
        ) {
            if (light) UndoSetupAction(this@HomeActivity, refresh) { refresh++ }
            androidx.compose.material3.TextButton(onClick = {
                startActivity(Intent(context, org.plainphone.app.contacts.HelpActivity::class.java))
            }) { Text(stringResource(R.string.help_lines_title)) }
            org.plainphone.app.safety.LocationSharingLine()
            if (snapshot != null) TimeLeft(snapshot)
            val install = rules?.toInstall.orEmpty().filterNot { isInstalled(context, it.packageName) }
            if (install.isNotEmpty()) InstallList(install)
            if (light) {
                val update = org.plainphone.app.update.SelfUpdate.report(context)
                if (update?.state == org.plainphone.app.update.SelfUpdater.STATE_PROMPTED) {
                    Spacer(Modifier.height(16.dp))
                    Text(stringResource(R.string.update_prompt_text, update.latestVersionName.orEmpty()))
                    FilledTonalButton(onClick = {
                        val url = ConfigStore(context).load().serverUrl.trimEnd('/') + "/download/android"
                        runCatching { startActivity(Intent(Intent.ACTION_VIEW, android.net.Uri.parse(url))) }
                    }) {
                        Text(stringResource(R.string.update_prompt_action))
                    }
                }
            }
            Spacer(Modifier.height(24.dp))
            Text(
                stringResource(R.string.version_line, versionName()),
                fontSize = 13.sp,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.clickable { onVersionTapped() }.padding(vertical = 12.dp),
            )
        }
    }

    private fun canAskToBeHome(context: Context): Boolean {
        val roles = context.getSystemService(RoleManager::class.java) ?: return false
        return HomeGuard.isEnabled(context) && roles.isRoleAvailable(RoleManager.ROLE_HOME) && !roles.isRoleHeld(RoleManager.ROLE_HOME)
    }

    private fun askToBeHome() {
        val roles = getSystemService(RoleManager::class.java) ?: return
        @Suppress("DEPRECATION") // A plain result-less request; onResume refreshes the screen.
        runCatching { startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_HOME), 1) }
    }

    @Composable
    private fun TimeLeft(s: TimeGuard.Snapshot) {
        val e = s.evaluation
        e.totalRemainingMs?.let { left ->
            Text(stringResource(R.string.today_left_total), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(duration(left), fontSize = 44.sp, lineHeight = 50.sp, fontWeight = FontWeight.SemiBold)
            Spacer(Modifier.height(8.dp))
        }
        if (e.appRemainingMs.isNotEmpty()) {
            Column {
                e.appRemainingMs.entries.sortedBy { label(it.key) }.forEach { (pkg, left) ->
                    val remaining = e.remainingFor(pkg) ?: left
                    StatusRow(label(pkg), if (remaining == 0L) stringResource(R.string.today_used_up) else duration(remaining), remaining > 0L)
                    HorizontalDivider(color = MaterialTheme.colorScheme.surfaceVariant)
                }
            }
        }
    }

    @Composable
    private fun InstallList(apps: List<CatalogInstall>) {
        Spacer(Modifier.height(16.dp))
        Text(stringResource(R.string.today_install_title), fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Text(stringResource(R.string.today_install_body), fontSize = 15.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)
        val canAuthorizeAccount = !Mode.isLight(this) && !ConfigStore(this).load().usesDefaultPin
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            apps.forEach { app ->
                Row(Modifier.fillMaxWidth().heightIn(min = 56.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(app.label, fontSize = 17.sp, modifier = Modifier.weight(1f))
                    FilledTonalButton(onClick = { install(app.packageName) }) { Text(stringResource(R.string.today_install_action)) }
                }
                if (canAuthorizeAccount) {
                    TextButton(onClick = {
                        startActivity(Intent(this@HomeActivity, MaintenanceActivity::class.java)
                            .putExtra(MaintenanceActivity.EXTRA_INSTALL_PACKAGE, app.packageName))
                    }) { Text(stringResource(R.string.today_install_with_account)) }
                }
            }
        }
    }

    private fun install(pkg: String) {
        // Strong mode applies the lock first (network for DNS): off the main thread.
        Executors.newSingleThreadExecutor().execute { InstallWindow.open(applicationContext, pkg) }
    }

    @Composable
    private fun duration(ms: Long): String {
        val minutes = ((ms + 59_999L) / 60_000L).toInt()
        val h = minutes / 60
        val m = minutes % 60
        return when {
            h == 0 -> stringResource(R.string.time_min, m)
            m == 0 -> stringResource(R.string.time_h, h)
            else -> stringResource(R.string.time_h_min, h, m)
        }
    }

    private fun label(pkg: String): String = runCatching {
        packageManager.getApplicationLabel(Compat.applicationInfo(packageManager, pkg, 0)).toString()
    }.getOrDefault(pkg)

    private fun isInstalled(context: Context, pkg: String) = runCatching { context.packageManager.getPackageInfo(pkg, 0) }.isSuccess

    private fun versionName() = packageManager.getPackageInfo(packageName, 0).versionName ?: "?"

    private fun onVersionTapped() {
        if (++taps >= MainActivity.TAPS_TO_MAINTENANCE) {
            taps = 0
            startActivity(Intent(this, MaintenanceActivity::class.java))
        }
    }

    companion object {
        fun intent(context: Context) = Intent(context, HomeActivity::class.java)

        /** Strong mode shows a "Today" button only when there is something on it. */
        fun hasContent(context: Context): Boolean {
            val rules = SyncStore(context).rules() ?: return false
            if (org.plainphone.app.safety.SafetyStore(context).sharingAlways) return true
            return rules.timeLimits != TimeLimits.NONE && !rules.timeLimits.isEmpty || rules.toInstall.isNotEmpty()
        }
    }
}
