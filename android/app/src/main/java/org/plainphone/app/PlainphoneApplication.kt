// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.ConnectivityManager
import android.net.Network
import android.util.Log
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.catalog.InstallWindow
import org.plainphone.app.time.TimeTicker

/**
 * Wakes the sync when it matters: the screen turns on (rules and "Find" within a minute while
 * the phone is in use, and school time switches exactly when someone looks) and the network
 * comes back. These broadcasts only reach a running app, and Plainphone usually runs: it is the
 * phone and SMS app. The 15-minute periodic sync covers the rest.
 */
class PlainphoneApplication : Application() {
    private var lastNetworkKick = 0L

    override fun onCreate() {
        super.onCreate()
        try {
            SyncScheduler.ensurePeriodic(this)
            registerReceiver(
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        Lock.applyIfNeededAsync(context, "screen on") {}
                        SyncScheduler.now(context, "screen on")
                    }
                },
                IntentFilter(Intent.ACTION_SCREEN_ON),
            )
            // Screen off: keep looking for a ring or an "Are you okay?" every 2 minutes (docs/location.md).
            registerReceiver(
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        org.plainphone.app.safety.Safety.scheduleIdlePoll(context)
                    }
                },
                IntentFilter(Intent.ACTION_SCREEN_OFF),
            )
            TimeTicker.register(this)
            // The filter went down (revoked or stopped): the parent hears it with this sync, not 15 minutes later.
            org.plainphone.app.light.vpn.VpnEvents.listener = { event ->
                if (event == org.plainphone.app.light.vpn.VpnEvent.Stopped) SyncScheduler.now(this, "DNS filter stopped")
            }
            // Install window (catalog apps) and new apps: react the moment a package arrives.
            registerReceiver(
                object : BroadcastReceiver() {
                    override fun onReceive(context: Context, intent: Intent) {
                        val pkg = intent.data?.schemeSpecificPart ?: return
                        if (intent.getBooleanExtra(Intent.EXTRA_REPLACING, false)) return // an update, not a new app
                        InstallWindow.onPackageAdded(context, pkg)
                        SyncScheduler.now(context, "app installed")
                    }
                },
                IntentFilter(Intent.ACTION_PACKAGE_ADDED).apply { addDataScheme("package") },
            )
            getSystemService(ConnectivityManager::class.java)?.registerDefaultNetworkCallback(
                object : ConnectivityManager.NetworkCallback() {
                    override fun onAvailable(network: Network) {
                        val now = System.currentTimeMillis()
                        val lastSync = SyncStore(this@PlainphoneApplication).lastSyncAtMs ?: 0L
                        if (now - lastSync < 60_000L || now - lastNetworkKick < 60_000L) return
                        lastNetworkKick = now
                        SyncScheduler.now(this@PlainphoneApplication, "network change")
                    }
                },
            )
        } catch (e: Exception) {
            // Never let the sync hooks stop the phone app from starting.
            Log.e("Plainphone", "could not set up sync triggers", e)
        }
    }
}
