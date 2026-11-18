// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import org.plainphone.app.settings.PhoneSettings
import org.plainphone.app.settings.SettingsApplier

/** One line in the status report: what was attempted and whether it held. */
data class StepResult(val name: String, val ok: Boolean, val detail: String = "", val profilesRemoved: Boolean = false) {
    override fun toString() = (if (ok) "OK   " else "FAIL ") + name + if (detail.isEmpty()) "" else ": $detail"
}

/** Remembers which apps we hid, so they can be shown again. */
interface HiddenAppsStore {
    fun load(): Set<String>
    fun save(packages: Set<String>)
    /** Apps suspended because their time is used up. */
    fun loadSuspended(): Set<String> = emptySet()
    fun saveSuspended(packages: Set<String>) = Unit
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
    private val hardening: Hardening? = null,
    /** Phone settings and the home screen (docs/phone-settings.md); null leaves them alone. */
    private val settings: SettingsApplier? = null,
    private val onInstallsAllowed: () -> Unit = {},
    private val clearInstallsIfAllowed: ((PolicyConfig, () -> Unit) -> Boolean)? = null,
    /** True while an install lease is open (update/InstallLease.kt): installs must get through. */
    private val installsAllowed: (PolicyConfig) -> Boolean = { it.installing != null },
) {

    fun applyInstallRestriction(config: PolicyConfig): StepResult = step(INSTALL_RESTRICTION_STEP) {
        if (installsAllowed(config)) {
            val clear = {
                device.clearRestriction(INSTALL_APPS)
                onInstallsAllowed()
            }
            try {
                if (clearInstallsIfAllowed == null) {
                    clear()
                } else if (!clearInstallsIfAllowed.invoke(config, clear)) {
                    device.addRestriction(INSTALL_APPS)
                }
            } finally {
                // The policy can change while the Binder call is in flight.
                if (!installsAllowed(config)) device.addRestriction(INSTALL_APPS)
            }
        } else {
            device.addRestriction(INSTALL_APPS)
        }
    }

    fun apply(config: PolicyConfig): List<StepResult> {
        if (!device.isDeviceOwner()) {
            return listOf(StepResult("device owner", false, "Plainphone is not Device Owner; nothing applied"))
        }
        val results = mutableListOf<StepResult>()

        // Roles first: DISALLOW_CONFIG_DEFAULT_APPS below then keeps the user from changing them back (Android 14+).
        results += step("default phone app") { takeRole(ROLE_DIALER, ::takeDialer) }
        results += step("default SMS app") { takeRole(ROLE_SMS) { device.setDefaultSms(device.ownPackage) } }
        hardening?.let { results += it.resetProtection(config.frpAccountIds) }
        for (key in LockPolicy.restrictions(sdkInt)) {
            results += if (key == INSTALL_APPS) applyInstallRestriction(config)
            else step("restriction $key") { device.addRestriction(key) }
        }
        results += step("block uninstall of Plainphone") { device.setUninstallBlocked(device.ownPackage, true) }
        results += step("automatic date and time") { device.requireAutoTime(true) }
        results += grantTelephonyPermissions()
        results += location(config)
        results += settings?.apply(config.server?.settings ?: PhoneSettings.NONE).orEmpty()
        // After the roles: the maker's phone and SMS apps are hidden once Plainphone holds the role
        // (below Android 14 the extra dialers always, see LockPolicy.telephonyAppsToHide).
        results += hideApps(config)
        results += suspendUsedUp(config)
        results += step("Chrome managed config (no DoH, no incognito, SafeSearch)") {
            device.setAppRestrictions(LockPolicy.CHROME_PACKAGE, LockPolicy.chromeRestrictions)
        }
        // Factory reset protection, force stop, accounts, extra users, keyboards (Hardening.kt).
        hardening?.let { results += it.applyOtherPolicies() }
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
        results += settings?.lift().orEmpty()
        results += step("time limits lifted") { setSuspended(emptySet()); null }
        results += step("private DNS back to automatic") { device.releasePrivateDns() }
        return results
    }

    /** Permanent exit for a test phone: undo everything, then give up Device Owner. */
    fun release(): List<StepResult> {
        if (!device.isDeviceOwner()) return listOf(StepResult("give up Device Owner", true, "already released"))
        val results = lift().toMutableList()
        if (!device.isDeviceOwner()) return listOf(StepResult("give up Device Owner", true, "already released"))
        // Once Device Owner is gone, nobody can show hidden apps again short of a factory reset.
        if (results.any { it.name == SHOW_HIDDEN && !it.ok }) {
            return results + StepResult("give up Device Owner", false, "stopped: some apps are still hidden; try again")
        }
        results += step("allow uninstall of Plainphone") { device.setUninstallBlocked(device.ownPackage, false) }
        results += step("clear Chrome managed config") { device.setAppRestrictions(LockPolicy.CHROME_PACKAGE, null) }
        hardening?.let { results += it.release() }
        if (results.any { it.name == "clear FRP policy" && !it.ok } && device.isDeviceOwner()) return results
        results += step("give phone and SMS roles back") { giveRolesBack() }
        // Failed cleanup may need Device Owner on the next attempt.
        if (results.all { it.ok }) results += step("give up Device Owner") { device.clearDeviceOwner() }
        return results
    }

    /**
     * Android 14+: Device Owner sets the phone app silently. Before that only the system dialog can,
     * which MainActivity shows (see [needsDialerDialog]); until it is accepted this step fails, so the
     * parent's status says calls are not filtered.
     */
    private fun takeDialer() {
        check(sdkInt >= 34) { "Android ${androidVersion(sdkInt)}: confirm Plainphone as phone app on the phone" }
        device.setDefaultDialer(device.ownPackage)
    }

    /** True when the phone app has to be requested with the system dialog (Android 10 to 13). */
    fun needsDialerDialog(): Boolean = sdkInt < 34 && device.isDeviceOwner() && !device.holdsRole(ROLE_DIALER)

    /** Returns a status text; throws if Android did not hand over the role. */
    private fun takeRole(role: String, take: () -> Unit): String {
        if (device.holdsRole(role)) return "already held"
        take()
        check(device.holdsRole(role)) { "Android did not grant $role" }
        return "granted"
    }

    private fun grantTelephonyPermissions(): StepResult = step("phone and SMS permissions") {
        val refused = LockPolicy.telephonyPermissions(sdkInt).filterNot { perm ->
            runCatching { device.grantPermission(device.ownPackage, perm) }.getOrDefault(false)
        }
        check(refused.isEmpty()) { "refused: ${refused.joinToString { it.substringAfterLast('.') }}" }
    }

    /** On release the phone becomes a normal phone again: the system dialer and the maker's SMS app take over. */
    private fun giveRolesBack(): String {
        val apps = device.telephonyApps()
        val notes = mutableListOf<String>()
        if (device.holdsRole(ROLE_DIALER)) {
            if (sdkInt >= 34) {
                apps.systemDialer?.takeIf { it != device.ownPackage }?.let { device.setDefaultDialer(it); notes += "phone: $it" }
            } else {
                // No silent way back before Android 14; Settings > Default apps works once Device Owner is gone.
                notes += "phone: choose the phone app in Settings (Android ${androidVersion(sdkInt)})"
            }
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
            settings?.let { return it.location(config.server?.settings ?: PhoneSettings.NONE) }
            return listOf(step("location setting free") { device.clearRestriction(LockPolicy.LOCATION_RESTRICTION) })
        }
        settings?.locationForced()
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
            device.telephonyApps(), device.ownPackage, device.holdsRole(ROLE_DIALER), device.holdsRole(ROLE_SMS), sdkInt,
        ) - parentAllowed
        // During school time and bedtime config.allowedPackages is already narrowed to the window's
        // list; core apps (phone, messages, camera, clock, contacts, Settings, launcher, keyboard) stay.
        val keep = protectedCallPackages() + device.corePackages() + config.allowedPackages - telephony +
            listOfNotNull(config.installing?.let { PolicyConfig.PLAY_STORE })
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

    /**
     * Time limits in strong mode: used-up apps are suspended (the icon stays, Android says the app
     * is paused) until the day ends. Core apps never get here (see TimeGuard.exempt).
     */
    private fun suspendUsedUp(config: PolicyConfig): StepResult = step("time limits") {
        val target = config.timeBlocked - device.corePackages() - protectedCallPackages()
        val refused = setSuspended(target)
        (if (target.isEmpty()) "nothing used up" else "${target.size} used up for today") +
            if (refused.isEmpty()) "" else "; Android refused: ${refused.joinToString()}"
    }

    private fun protectedCallPackages(): Set<String> =
        setOfNotNull(device.ownPackage, device.telephonyApps().systemDialer)

    private fun setSuspended(target: Set<String>): Set<String> {
        val before = hiddenStore.loadSuspended()
        val release = (before - target).filter(device::isInstalled).toSet()
        val failedOff = if (release.isEmpty()) emptySet() else device.setSuspended(release, false)
        val failedOn = if (target.isEmpty()) emptySet() else device.setSuspended(target, true)
        hiddenStore.saveSuspended(target - failedOn + failedOff)
        // Android refuses some packages (for example the active launcher): not a hole in the lock.
        return (failedOn + failedOff)
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

    companion object {
        const val INSTALL_RESTRICTION_STEP = "restriction no_install_apps"
        /** Android version for an API level, for status texts (29 = 10 ... 33 = 13). */
        private fun androidVersion(sdkInt: Int) = if (sdkInt in 29..33) (sdkInt - 19).toString() else "API $sdkInt"

        private const val SHOW_HIDDEN = "show hidden apps"
        private const val INSTALL_APPS = "no_install_apps" // UserManager.DISALLOW_INSTALL_APPS
        // RoleManager.ROLE_DIALER / ROLE_SMS, as plain strings so the class stays JVM-testable.
        private const val ROLE_DIALER = "android.app.role.DIALER"
        private const val ROLE_SMS = "android.app.role.SMS"
    }

    private inline fun step(name: String, block: () -> Any?): StepResult = try {
        val out = block()
        StepResult(name, true, if (out is String) out else "")
    } catch (e: Exception) {
        StepResult(name, false, "${e.javaClass.simpleName}: ${e.message}")
    }
}
