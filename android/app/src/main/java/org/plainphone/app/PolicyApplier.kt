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

        for (key in LockPolicy.restrictions(sdkInt)) {
            results += step("restriction $key") { device.addRestriction(key) }
        }
        results += step("block uninstall of Plainphone") { device.setUninstallBlocked(device.ownPackage, true) }
        results += step("automatic date and time") { device.requireAutoTime(true) }
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
        for (key in LockPolicy.restrictions(sdkInt)) {
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
        results += step("give up Device Owner") { device.clearDeviceOwner() }
        return results
    }

    private fun hideApps(config: PolicyConfig): List<StepResult> = try {
        hideAppsUnguarded(config)
    } catch (e: Exception) {
        listOf(StepResult("hide apps outside the allowlist", false, "${e.javaClass.simpleName}: ${e.message}"))
    }

    private fun hideAppsUnguarded(config: PolicyConfig): List<StepResult> {
        val previously = hiddenStore.load().filter(device::isInstalled).toSet()
        val keep = device.corePackages() + config.allowedPackages + device.ownPackage
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
                "hide apps outside the allowlist",
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
    }

    private inline fun step(name: String, block: () -> Any?): StepResult = try {
        val out = block()
        StepResult(name, true, if (out is String) out else "")
    } catch (e: Exception) {
        StepResult(name, false, "${e.javaClass.simpleName}: ${e.message}")
    }
}
