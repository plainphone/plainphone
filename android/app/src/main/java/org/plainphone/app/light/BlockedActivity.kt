// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.ui.res.stringResource
import org.plainphone.app.Compat
import org.plainphone.app.MaintenanceActivity
import org.plainphone.app.R
import org.plainphone.app.ui.PlainphoneTheme

/** The calm screen shown instead of a blocked app or a locked setting (light mode and time limits). */
class BlockedActivity : ComponentActivity() {
    enum class Reason { NOT_ALLOWED, TIME_USED_UP, PROTECTION }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        render(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        render(intent)
    }

    private fun render(intent: Intent) {
        val reason = runCatching { Reason.valueOf(intent.getStringExtra(EXTRA_REASON) ?: "") }.getOrDefault(Reason.NOT_ALLOWED)
        val label = label(intent.getStringExtra(EXTRA_PACKAGE))
        setContent {
            PlainphoneTheme {
                when (reason) {
                    Reason.NOT_ALLOWED -> CalmScreen(
                        eyebrow = label,
                        title = stringResource(R.string.blocked_not_allowed_title),
                        body = stringResource(R.string.blocked_not_allowed_body),
                        primary = stringResource(R.string.blocked_ok),
                        onPrimary = ::goHome,
                    )
                    Reason.TIME_USED_UP -> CalmScreen(
                        eyebrow = label,
                        title = stringResource(R.string.blocked_time_title),
                        body = stringResource(R.string.blocked_time_body),
                        primary = stringResource(R.string.blocked_ok),
                        onPrimary = ::goHome,
                    )
                    Reason.PROTECTION -> CalmScreen(
                        eyebrow = null,
                        title = stringResource(R.string.blocked_protection_title),
                        body = stringResource(R.string.blocked_protection_body),
                        primary = stringResource(R.string.blocked_ok),
                        onPrimary = ::goHome,
                        secondary = stringResource(R.string.blocked_enter_pin),
                        onSecondary = {
                            startActivity(Intent(this, MaintenanceActivity::class.java))
                            finish()
                        },
                    )
                }
            }
        }
    }

    private fun goHome() {
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    private fun label(pkg: String?): String? = pkg?.let {
        runCatching {
            packageManager.getApplicationLabel(Compat.applicationInfo(packageManager, it, PackageManager.MATCH_UNINSTALLED_PACKAGES)).toString()
        }.getOrNull()
    }

    companion object {
        private const val EXTRA_PACKAGE = "package"
        private const val EXTRA_REASON = "reason"

        fun intent(context: Context, pkg: String, reason: Reason): Intent =
            Intent(context, BlockedActivity::class.java)
                .putExtra(EXTRA_PACKAGE, pkg)
                .putExtra(EXTRA_REASON, reason.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
    }
}
