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
import org.plainphone.app.Compat
import org.plainphone.app.MaintenanceActivity
import org.plainphone.app.ui.PhoneActivity
import org.plainphone.app.ui.PlainphoneTheme

/** The calm screen shown instead of a blocked app or a locked setting (light mode and time limits). */
class BlockedActivity : ComponentActivity() {
    /** [OTHER] is the neutral fallback when the reason is missing or unknown. */
    enum class Reason { NOT_ALLOWED, TIME_USED_UP, PROTECTION, OTHER }

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
        val reason = runCatching { Reason.valueOf(intent.getStringExtra(EXTRA_REASON) ?: "") }.getOrDefault(Reason.OTHER)
        val label = label(intent.getStringExtra(EXTRA_PACKAGE))
        setContent {
            PlainphoneTheme {
                BlockedScreen(
                    reason = reason,
                    appLabel = label,
                    onHome = ::goHome,
                    onReachParent = ::reachParent,
                    onEnterPin = {
                        startActivity(Intent(this, MaintenanceActivity::class.java))
                        finish()
                    },
                )
            }
        }
    }

    private fun goHome() {
        startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        finish()
    }

    private fun reachParent() {
        startActivity(PhoneActivity.favouritesIntent(this).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
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
