// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.app.admin.DevicePolicyManager
import android.content.Context
import org.plainphone.app.StepResult
import org.plainphone.app.light.vpn.PlainphoneVpnService
import org.plainphone.app.sync.SyncStore

/**
 * Switching light mode off with the maintenance PIN, so Plainphone can be uninstalled normally:
 * device admin off, VPN stopped, the guard switched off. The parent sees the protections go.
 */
object LightRelease {
    fun release(context: Context): List<StepResult> = buildList {
        val undoPending = SyncStore(context).setupUndoPending
        // Keep Android's uninstall barrier until the server has durably accepted the report.
        if (!undoPending) add(step("device admin off") { removeAdmin(context) })
        prefs(context).edit().putBoolean(KEY_RELEASED, true).apply()
        add(step("DNS filter (VPN) stopped") {
            PlainphoneVpnService.stop(context)
        })
        add(step("guard off") {
            // During undo, a disconnected guard will switch itself off before handling any events.
            if (Protections.isGuardEnabled(context) && !GuardService.disable() && !undoPending) {
                error("switch it off in Settings > Accessibility")
            }
        })
        LightSetup.clearAfterRelease(context, undoPending)
    }

    internal fun removeAdmin(context: Context) {
        val policy = context.getSystemService(DevicePolicyManager::class.java)
        val admin = LightAdminReceiver.component(context)
        if (policy.isAdminActive(admin)) policy.removeActiveAdmin(admin)
    }

    /** After a release no apply starts the VPN or the plan again, until setup is completed anew. */
    fun isReleased(context: Context) = prefs(context).getBoolean(KEY_RELEASED, false)

    fun clear(context: Context) {
        prefs(context).edit().remove(KEY_RELEASED).apply()
    }

    private const val KEY_RELEASED = "released"
    private fun prefs(context: Context) = context.getSharedPreferences("plainphone_light", Context.MODE_PRIVATE)

    private inline fun step(name: String, block: () -> Unit): StepResult = try {
        block()
        StepResult(name, true)
    } catch (e: Exception) {
        StepResult(name, false, e.message ?: e.javaClass.simpleName)
    }
}
