// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.plainphone.app.contacts.ContactPolicySources
import org.plainphone.app.Compat
import org.plainphone.app.MaintenanceActivity
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.time.MoreTime
import org.plainphone.app.ui.PhoneActivity
import org.plainphone.app.ui.PlainphoneTheme

/** The calm screen shown instead of a blocked app or a locked setting (light mode and time limits). */
class BlockedActivity : ComponentActivity() {
    /** [OTHER] is the neutral fallback when the reason is missing or unknown. */
    enum class Reason { NOT_ALLOWED, TIME_USED_UP, PROTECTION, OTHER }

    /** Only refresh the ask while the screen can be seen. */
    private var onScreen by mutableStateOf(false)
    private var rulesChanged by mutableIntStateOf(0)
    // Held here: SharedPreferences keeps listeners weakly.
    private val rulesListener = SharedPreferences.OnSharedPreferenceChangeListener { _, key ->
        if (key == "rules") rulesChanged++
    }

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
        val pkg = intent.getStringExtra(EXTRA_PACKAGE)
        val label = label(pkg)
        val asking = pkg?.takeIf { reason == Reason.TIME_USED_UP }?.let { AskMoreTimeController(this, it) }
        setContent {
            val showParent by produceState(true) {
                value = withContext(Dispatchers.IO) { !ContactPolicySources.get(this@BlockedActivity).rules().selfProfile }
            }
            var ask by remember { mutableStateOf<MoreTime.Ui?>(null) }
            var composing by rememberSaveable { mutableStateOf(false) }
            val scope = rememberCoroutineScope()
            val active = onScreen
            val tick = rulesChanged
            // Fresh at once, after every rules sync, and every 15 s while the screen can be seen.
            LaunchedEffect(asking, active, tick) {
                while (asking != null && active) {
                    ask = withContext(Dispatchers.IO) { runCatching { asking.state() }.getOrNull() } ?: ask
                    delay(POLL_MS)
                }
            }
            PlainphoneTheme {
                BlockedScreen(
                    showParent = showParent,
                    reason = reason,
                    appLabel = label,
                    onHome = ::goHome,
                    onReachParent = ::reachParent,
                    onEnterPin = {
                        startActivity(Intent(this, MaintenanceActivity::class.java))
                        finish()
                    },
                    ask = ask?.let { if (it == MoreTime.Ui.Offer && composing) MoreTime.Ui.Composing else it },
                    onAsk = { composing = true },
                    onSendAsk = { text ->
                        composing = false
                        scope.launch { ask = withContext(Dispatchers.IO) { runCatching { asking?.ask(text) }.getOrNull() } ?: ask }
                    },
                )
            }
        }
    }

    override fun onStart() {
        super.onStart()
        onScreen = true
        getSharedPreferences(SyncStore.PREFS, MODE_PRIVATE).registerOnSharedPreferenceChangeListener(rulesListener)
    }

    override fun onStop() {
        getSharedPreferences(SyncStore.PREFS, MODE_PRIVATE).unregisterOnSharedPreferenceChangeListener(rulesListener)
        onScreen = false
        super.onStop()
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
        private const val POLL_MS = 15_000L

        fun intent(context: Context, pkg: String, reason: Reason): Intent =
            Intent(context, BlockedActivity::class.java)
                .putExtra(EXTRA_PACKAGE, pkg)
                .putExtra(EXTRA_REASON, reason.name)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
    }
}
