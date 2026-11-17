// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import org.plainphone.app.StepResult
import org.plainphone.app.light.vpn.PlainphoneVpnService

/**
 * Switching light mode off with the maintenance PIN, so Plainphone can be uninstalled normally:
 * device admin off, VPN stopped, the guard switched off. The parent sees the protections go.
 */
object LightRelease {
    fun release(context: Context): List<StepResult> = buildList {
        add(step("device admin off") {
            context.getSystemService(DevicePolicyManager::class.java).removeActiveAdmin(LightAdminReceiver.component(context))
        })
        add(step("DNS filter (VPN) stopped") {
            context.stopService(Intent(context, PlainphoneVpnService::class.java))
        })
        add(step("guard off") {
            check(GuardService.disable()) { "switch it off in Settings > Accessibility" }
        })
        context.getSharedPreferences("plainphone_light_setup", Context.MODE_PRIVATE).edit().clear().apply()
    }

    private inline fun step(name: String, block: () -> Unit): StepResult = try {
        block()
        StepResult(name, true)
    } catch (e: Exception) {
        StepResult(name, false, e.message ?: e.javaClass.simpleName)
    }
}
