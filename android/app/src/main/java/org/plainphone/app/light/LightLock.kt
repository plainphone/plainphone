// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import android.net.VpnService
import android.os.Build
import org.plainphone.app.AndroidDeviceControls
import org.plainphone.app.LockPolicy
import org.plainphone.app.PolicyConfig
import org.plainphone.app.StepResult
import org.plainphone.app.light.vpn.PlainphoneVpnService
import org.plainphone.app.sync.SyncStore

/**
 * Light mode's "apply": without Device Owner nothing can be hidden or forbidden, so the lock is
 * a plan that [GuardService] enforces when an app comes to the front, plus the DNS VPN. Every
 * protection is a step, so a missing one shows up in the parent's status as a failed policy.
 */
object LightLock {
    private const val PREFS = "plainphone_light"

    fun apply(context: Context, config: PolicyConfig): List<StepResult> {
        if (LightRelease.isReleased(context)) {
            save(context, LightPlan(emptySet(), emptySet()))
            return listOf(StepResult("light mode switched off with the PIN", false, "set Plainphone up again to protect the phone"))
        }
        if (!LightSetup.isComplete(context) && LightSetup.next(context) == null) LightSetup.markComplete(context)
        val results = mutableListOf<StepResult>()
        val hasLimits = SyncStore(context).rules()?.timeLimits?.isEmpty == false

        results += planSteps(context, config)
        if (config.filterMethod == FilterMethod.VPN) {
            results += vpnStep(context, config.dnsHost)
        } else {
            PlainphoneVpnService.stop(context)
        }
        val now = Protections.read(context, config.dnsHost, needsUsageAccess = hasLimits)
        results += StepResult("device admin (uninstall needs it switched off first)", now.deviceAdmin)
        results += StepResult("accessibility service (closes blocked apps)", now.accessibility)
        results += StepResult("default phone app", now.phoneRole)
        results += StepResult("default SMS app", now.smsRole)
        if (config.filterMethod == FilterMethod.VPN) results += StepResult("private DNS not pointing elsewhere", now.privateDnsOk)
        if (hasLimits) results += StepResult("usage access (time limits)", now.usageAccess)
        // Recommended, not required: reported as OK with a note so the lock stays intact without them.
        if (config.filterMethod == FilterMethod.VPN) results += StepResult("always-on VPN", true, if (now.alwaysOnVpn) "on" else "off: switch it on in Settings > VPN")
        results += StepResult("battery: not optimised", true, if (now.batteryUnrestricted) "yes" else "no: Android may stop Plainphone")
        return results
    }

    /** What the guard blocks: the same rules as strong mode's hide plan, plus used-up apps. */
    private fun planSteps(context: Context, config: PolicyConfig): StepResult = try {
        if (config.server == null) {
            // Not paired yet (or no rules): a phone already in use must not lose its apps before the parent has chosen.
            save(context, LightPlan(emptySet(), emptySet()))
            return StepResult("block apps outside the allowlist", true, "waiting for the parent's rules")
        }
        val device = AndroidDeviceControls(context)
        val roles = context.getSystemService(android.app.role.RoleManager::class.java)
        val telephony = LockPolicy.telephonyAppsToHide(
            device.telephonyApps(),
            context.packageName,
            roles?.isRoleHeld(android.app.role.RoleManager.ROLE_DIALER) == true,
            roles?.isRoleHeld(android.app.role.RoleManager.ROLE_SMS) == true,
            Build.VERSION.SDK_INT,
        )
        val plan = LightPlan.build(
            launchable = device.launchablePackages(),
            core = device.corePackages(),
            allowed = config.allowedPackages,
            ownPackage = context.packageName,
            telephony = telephony,
            timeBlocked = config.timeBlocked,
            installing = config.installing,
        )
        save(context, plan)
        StepResult(
            if (config.server.windowActive) "block apps outside the allowlist (school time or bedtime)" else "block apps outside the allowlist",
            true,
            "${plan.blocked.size} blocked" + if (plan.timeBlocked.isEmpty()) "" else ", ${plan.timeBlocked.size} used up for today",
        )
    } catch (e: Exception) {
        StepResult("block apps outside the allowlist", false, "${e.javaClass.simpleName}: ${e.message}")
    }

    private fun vpnStep(context: Context, host: String): StepResult {
        // Consent is given once in the setup screen; without it the VPN cannot start in the background.
        if (VpnService.prepare(context) != null) return StepResult("DNS filter (VPN)", false, "not allowed yet")
        return try {
            if (PlainphoneVpnService.start(context, host) || PlainphoneVpnService.isRunning()) {
                StepResult("DNS filter (VPN)", true, host)
            } else {
                StepResult("DNS filter (VPN)", false, "Android did not start it (Plainphone in the background?)")
            }
        } catch (e: Exception) {
            StepResult("DNS filter (VPN)", false, "${e.javaClass.simpleName}: ${e.message}")
        }
    }

    fun plan(context: Context): LightPlan {
        val p = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return LightPlan(
            blocked = p.getStringSet("blocked", null)?.toSet().orEmpty(),
            timeBlocked = p.getStringSet("time_blocked", null)?.toSet().orEmpty(),
        )
    }

    private fun save(context: Context, plan: LightPlan) {
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
            .putStringSet("blocked", plan.blocked)
            .putStringSet("time_blocked", plan.timeBlocked)
            .apply()
    }
}

/**
 * Pure: which apps the guard closes. [blocked] are apps the parent has not allowed (or the
 * maker's phone and SMS apps), [timeBlocked] apps whose time is used up today.
 */
data class LightPlan(val blocked: Set<String>, val timeBlocked: Set<String>) {
    enum class Why { NOT_ALLOWED, TIME_USED_UP }

    fun why(pkg: String): Why? = when (pkg) {
        in blocked -> Why.NOT_ALLOWED
        in timeBlocked -> Why.TIME_USED_UP
        else -> null
    }

    companion object {
        fun build(
            launchable: Set<String>,
            core: Set<String>,
            allowed: Set<String>,
            ownPackage: String,
            telephony: Set<String>,
            timeBlocked: Set<String>,
            installing: String?,
        ): LightPlan {
            val keep = core + allowed + ownPackage - telephony + listOfNotNull(installing?.let { PolicyConfig.PLAY_STORE })
            val blocked = LockPolicy.hidePlan(launchable, keep, emptySet()).hide
            return LightPlan(blocked, timeBlocked - core - ownPackage - blocked)
        }
    }
}
