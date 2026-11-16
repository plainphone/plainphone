// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.Activity
import android.app.admin.DevicePolicyManager
import android.content.Intent
import android.graphics.Typeface
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView

/**
 * Status screen. Tapping the version line [TAPS_TO_MAINTENANCE] times opens the
 * PIN-protected maintenance screen.
 */
class MainActivity : Activity() {
    private lateinit var status: TextView
    private lateinit var report: TextView
    private var taps = 0

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val pad = (20 * resources.displayMetrics.density).toInt()
        val column = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(pad, pad * 2, pad, pad)
        }
        column.addView(TextView(this).apply {
            text = getString(R.string.app_name)
            textSize = 28f
            setTypeface(typeface, Typeface.BOLD)
        })
        column.addView(TextView(this).apply {
            text = getString(R.string.phase_notice)
            textSize = 15f
            setPadding(0, pad / 2, 0, pad)
        })
        status = TextView(this).apply { textSize = 17f }
        column.addView(status)
        report = TextView(this).apply {
            typeface = Typeface.MONOSPACE
            textSize = 12f
            setPadding(0, pad, 0, pad)
            setTextIsSelectable(true)
        }
        column.addView(report)
        column.addView(TextView(this).apply {
            text = getString(R.string.version_line, BuildConfigInfo.versionName(this@MainActivity))
            textSize = 13f
            alpha = 0.6f
            setPadding(0, pad, 0, pad)
            setOnClickListener { onVersionTapped() }
        })
        setContentView(ScrollView(this).apply { addView(column) })
    }

    override fun onResume() {
        super.onResume()
        taps = 0
        refresh()
        // Self-healing: every time the app is opened the lock is re-applied,
        // unless a parent has lifted it for maintenance.
        if (isDeviceOwner() && !Lock.isInMaintenanceWindow(this)) {
            Lock.applyAsync(this, if (intent?.action == DevicePolicyManager.ACTION_PROVISIONING_SUCCESSFUL) "provisioning successful" else "app opened") {
                runOnUiThread { refresh() }
            }
        }
    }

    private fun refresh() {
        val config = ConfigStore(this).load()
        status.text = buildString {
            appendLine(if (isDeviceOwner()) getString(R.string.status_owner) else getString(R.string.status_not_owner))
            if (Lock.isInMaintenanceWindow(this@MainActivity)) appendLine(getString(R.string.status_maintenance))
            appendLine(getString(R.string.status_dns, config.dnsHost))
            if (config.usesDefaultPin) appendLine(getString(R.string.status_default_pin))
        }
        report.text = Lock.lastReport(this)
    }

    private fun onVersionTapped() {
        taps++
        if (taps >= TAPS_TO_MAINTENANCE) {
            taps = 0
            startActivity(Intent(this, MaintenanceActivity::class.java))
        }
    }

    private fun isDeviceOwner() = getSystemService(DevicePolicyManager::class.java).isDeviceOwnerApp(packageName)

    companion object {
        const val TAPS_TO_MAINTENANCE = 7
    }
}

internal object BuildConfigInfo {
    fun versionName(activity: Activity): String =
        activity.packageManager.getPackageInfo(activity.packageName, 0).versionName ?: "?"
}

