// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

/** In-memory device for testing the policy logic without Android. */
class FakeDevice(
    var owner: Boolean = true,
    val launchable: MutableSet<String> = mutableSetOf(),
    val core: Set<String> = emptySet(),
) : DeviceControls {
    override val ownPackage = "org.plainphone.app"
    val restrictions = mutableSetOf<String>()
    val hidden = mutableSetOf<String>()
    val unhideable = mutableSetOf<String>()
    var dnsHost: String? = null
    var dnsFails = false
    var frp: Set<String>? = null
    var frpUnsupported = false
    val uninstallBlocked = mutableSetOf<String>()
    var autoTime = false
    val appRestrictions = mutableMapOf<String, Map<String, Any>?>()

    override fun isDeviceOwner() = owner
    override fun addRestriction(key: String) { restrictions += key }
    override fun clearRestriction(key: String) { restrictions -= key }
    // Like Android: hidden apps disappear from the launcher query.
    override fun launchablePackages() = launchable - hidden
    override fun corePackages() = core
    override fun isInstalled(pkg: String) = pkg in launchable
    override fun setHidden(pkg: String, hidden: Boolean): Boolean {
        if (pkg in unhideable) return false
        if (hidden) this.hidden += pkg else this.hidden -= pkg
        return true
    }
    override fun isHidden(pkg: String) = pkg in hidden
    override fun forcePrivateDns(host: String): String {
        check(!dnsFails) { "host not serving" }
        dnsHost = host
        return "forced"
    }
    override fun releasePrivateDns() { dnsHost = null }
    override fun setAppRestrictions(pkg: String, values: Map<String, Any>?) { appRestrictions[pkg] = values }
    override fun setFrpAccounts(accountIds: Set<String>?) {
        if (frpUnsupported) throw UnsupportedOperationException("no FRP on this device")
        frp = accountIds
    }
    override fun setUninstallBlocked(pkg: String, blocked: Boolean) {
        if (blocked) uninstallBlocked += pkg else uninstallBlocked -= pkg
    }
    override fun requireAutoTime(required: Boolean) { autoTime = required }
    override fun clearDeviceOwner() { owner = false }
}

class MemoryHiddenStore : HiddenAppsStore {
    var saved: Set<String> = emptySet()
    override fun load() = saved
    override fun save(packages: Set<String>) { saved = packages }
}
