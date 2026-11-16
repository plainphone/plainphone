// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

/** One line in the status report: what was attempted and whether it held. */
data class StepResult(val name: String, val ok: Boolean, val detail: String = "") {
    override fun toString() = (if (ok) "OK   " else "FAIL ") + name + if (detail.isEmpty()) "" else ": $detail"
}

/** Remembers which apps we hid, so they can be shown again. */
interface HiddenAppsStore {
    fun load(): Set<String>
    fun save(packages: Set<String>)
}

/**
 * Applies, lifts and releases the lock. Every step is independent: one failure
 * (for example private DNS while offline) never stops the others, and the
 * result list says exactly what held.
 */
class PolicyApplier(
    private val device: DeviceControls,
    private val hiddenStore: HiddenAppsStore,
    private val sdkInt: Int,
) {

    fun apply(config: PolicyConfig): List<StepResult> {
        if (!device.isDeviceOwner()) {
            return listOf(StepResult("device owner", false, "Plainphone is not Device Owner; nothing applied"))
        }
        val results = mutableListOf<StepResult>()

        // Roles first: DISALLOW_CONFIG_DEFAULT_APPS below then keeps the user from changing them back.
        results += step("default phone app") { takeRole(ROLE_DIALER) { device.setDefaultDialer(device.ownPackage) } }
        results += step("default SMS app") { takeRole(ROLE_SMS) { device.setDefaultSms(device.ownPackage) } }
        for (key in LockPolicy.restrictions(sdkInt)) {
            results += step("restriction $key") { device.addRestriction(key) }
        }
        results += step("block uninstall of Plainphone") { device.setUninstallBlocked(device.ownPackage, true) }
        results += step("automatic date and time") { device.requireAutoTime(true) }
        results += grantTelephonyPermissions()
        results += location(config)
        // After the roles: the maker's phone and SMS apps are only hidden once Plainphone holds the role.
        results += hideApps(config)
        results += step("Chrome managed config (no DoH, no incognito, SafeSearch)") {
            device.setAppRestrictions(LockPolicy.CHROME_PACKAGE, LockPolicy.chromeRestrictions)
        }
        results += if (config.frpAccountIds.isEmpty()) {
            StepResult("factory reset protection", true, "no account IDs configured; Android default FRP applies")
        } else {
            step("factory reset protection (${config.frpAccountIds.size} account(s))") {
                device.setFrpAccounts(config.frpAccountIds)
            }
        }
        // Last, because it waits on the network.
        results += step("private DNS") { device.forcePrivateDns(config.dnsHost) }
        return results
    }

    /** Temporary maintenance unlock. The lock comes back via [apply] (alarm or reboot). */
    fun lift(): List<StepResult> {
        if (!device.isDeviceOwner()) return listOf(StepResult("device owner", false, "not Device Owner"))
        val results = mutableListOf<StepResult>()
        for (key in LockPolicy.restrictions(sdkInt) + LockPolicy.LOCATION_RESTRICTION) {
            results += step("clear $key") { device.clearRestriction(key) }
        }
        results += showAllHidden()
        results += step("private DNS back to automatic") { device.releasePrivateDns() }
        return results
    }

    /** Permanent exit for a test phone: undo everything, then give up Device Owner. */
    fun release(): List<StepResult> {
        val results = lift().toMutableList()
        if (!device.isDeviceOwner()) return results
        // Once Device Owner is gone, nobody can show hidden apps again short of a factory reset.
        if (results.any { it.name == SHOW_HIDDEN && !it.ok }) {
            return results + StepResult("give up Device Owner", false, "stopped: some apps are still hidden; try again")
        }
        results += step("allow uninstall of Plainphone") { device.setUninstallBlocked(device.ownPackage, false) }
        results += step("clear Chrome managed config") { device.setAppRestrictions(LockPolicy.CHROME_PACKAGE, null) }
        results += step("clear FRP policy") { device.setFrpAccounts(null) }
        results += step("give phone and SMS roles back") { giveRolesBack() }
        results += step("give up Device Owner") { device.clearDeviceOwner() }
        return results
    }

    /** Returns a status text; throws if Android did not hand over the role. */
    private fun takeRole(role: String, take: () -> Unit): String {
        if (device.holdsRole(role)) return "already held"
        take()
        check(device.holdsRole(role)) { "Android did not grant $role" }
        return "granted"
    }

    private fun grantTelephonyPermissions(): StepResult = step("phone and SMS permissions") {
        val refused = LockPolicy.TELEPHONY_PERMISSIONS.filterNot { perm ->
            runCatching { device.grantPermission(device.ownPackage, perm) }.getOrDefault(false)
        }
        check(refused.isEmpty()) { "refused: ${refused.joinToString { it.substringAfterLast('.') }}" }
    }

    /** On release the phone becomes a normal phone again: the system dialer and the maker's SMS app take over. */
    private fun giveRolesBack(): String {
        val apps = device.telephonyApps()
        val notes = mutableListOf<String>()
        if (device.holdsRole(ROLE_DIALER)) {
            apps.systemDialer?.takeIf { it != device.ownPackage }?.let { device.setDefaultDialer(it); notes += "phone: $it" }
        }
        if (device.holdsRole(ROLE_SMS)) {
            // Prefer the SMS app that came with the phone (Samsung Messages on a Samsung, and so on).
            val candidates = apps.smsApps - device.ownPackage
            ((apps.systemSmsApps intersect candidates).minOrNull() ?: candidates.minOrNull())
                ?.let { device.setDefaultSms(it); notes += "SMS: $it" }
        }
        return notes.joinToString().ifEmpty { "nothing to give back" }
    }

    /**
     * Location for "Find" (spec 7). Only when the parent turned it on: then the permission is
     * granted by Device Owner (no dialog for the child), location is switched on and stays on.
     */
    private fun location(config: PolicyConfig): List<StepResult> {
        if (config.server?.locationRequired != true) {
            return listOf(step("location setting free") { device.clearRestriction(LockPolicy.LOCATION_RESTRICTION) })
        }
        return listOf(
            step("location permission") {
                val refused = LockPolicy.LOCATION_PERMISSIONS.filterNot { perm ->
                    runCatching { device.grantPermission(device.ownPackage, perm) }.getOrDefault(false)
                }
                check(refused.isEmpty()) { "refused: ${refused.joinToString { it.substringAfterLast('.') }}" }
            },
            step("location on") { device.setLocationEnabled(true) },
            step("restriction ${LockPolicy.LOCATION_RESTRICTION}") { device.addRestriction(LockPolicy.LOCATION_RESTRICTION) },
        )
    }

    private fun hideApps(config: PolicyConfig): List<StepResult> = try {
        hideAppsUnguarded(config)
    } catch (e: Exception) {
        listOf(StepResult("hide apps outside the allowlist", false, "${e.javaClass.simpleName}: ${e.message}"))
    }

    private fun hideAppsUnguarded(config: PolicyConfig): List<StepResult> {
        val previously = hiddenStore.load().filter(device::isInstalled).toSet()
        // Apps the parent explicitly allowed in the QR code stay visible, even if they can be a phone or SMS app.
        // With rules from the server the maker's phone and SMS apps are always hidden: the dashboard
        // must not be able to open a way around approved contacts by showing one of them.
        val parentAllowed = if (config.server != null) emptySet() else config.allowedPackages - PolicyConfig.DEFAULT_ALLOWED_PACKAGES
        val telephony = LockPolicy.telephonyAppsToHide(
            device.telephonyApps(), device.ownPackage, device.holdsRole(ROLE_DIALER), device.holdsRole(ROLE_SMS),
        ) - parentAllowed
        // During school time and bedtime config.allowedPackages is already narrowed to the window's
        // list; core apps (phone, messages, camera, clock, contacts, Settings, launcher, keyboard) stay.
        val keep = device.corePackages() + config.allowedPackages + device.ownPackage - telephony
        val plan = LockPolicy.hidePlan(device.launchablePackages() + previously, keep, previously)
        val nowHidden = previously.toMutableSet()
        val failed = mutableListOf<String>()
        for (pkg in plan.unhide) {
            if (runCatching { device.setHidden(pkg, false) || !device.isHidden(pkg) }.getOrDefault(false)) {
                nowHidden -= pkg
            } else {
                failed += "show $pkg"
            }
        }
        for (pkg in plan.hide) {
            val ok = runCatching { device.setHidden(pkg, true) || device.isHidden(pkg) }.getOrDefault(false)
            if (ok) nowHidden += pkg else failed += "hide $pkg"
        }
        hiddenStore.save(nowHidden)
        return listOf(
            StepResult(
                if (config.server?.windowActive == true) "hide apps outside the allowlist (school time or bedtime)" else "hide apps outside the allowlist",
                failed.isEmpty(),
                "${nowHidden.size} hidden" + if (failed.isEmpty()) "" else "; failed: ${failed.joinToString()}",
            ),
        )
    }

    private fun showAllHidden(): StepResult = try {
        showAllHiddenUnguarded()
    } catch (e: Exception) {
        StepResult(SHOW_HIDDEN, false, "${e.javaClass.simpleName}: ${e.message}")
    }

    private fun showAllHiddenUnguarded(): StepResult {
        val hidden = hiddenStore.load()
        val failed = hidden.filterNot { pkg ->
            !device.isInstalled(pkg) || runCatching { device.setHidden(pkg, false) || !device.isHidden(pkg) }.getOrDefault(false)
        }
        hiddenStore.save(failed.toSet())
        return StepResult(SHOW_HIDDEN, failed.isEmpty(), "${hidden.size - failed.size} shown")
    }

    private companion object {
        const val SHOW_HIDDEN = "show hidden apps"
        // RoleManager.ROLE_DIALER / ROLE_SMS, as plain strings so the class stays JVM-testable.
        const val ROLE_DIALER = "android.app.role.DIALER"
        const val ROLE_SMS = "android.app.role.SMS"
    }

    private inline fun step(name: String, block: () -> Any?): StepResult = try {
        val out = block()
        StepResult(name, true, if (out is String) out else "")
    } catch (e: Exception) {
        StepResult(name, false, "${e.javaClass.simpleName}: ${e.message}")
    }
}
