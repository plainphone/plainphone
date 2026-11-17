// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

/** In-memory [HardeningControls] for the JVM tests. */
class FakeHardening : HardeningControls {
    override val ownPackage = "org.plainphone.app"
    var playServices = true
    var frpUnsupported = false
    var policyAccounts: List<String>? = null
    var policyWritten = false
    var legacyFrp: List<String>? = null
    var legacyFrpSet = false
    var legacyWriteRefused = false
    var broadcasts = 0
    var accounts = mutableListOf<String>()
    var noUserControl: List<String> = emptyList()
    val users = mutableListOf<ExtraUser>()
    val unremovable = mutableSetOf<Int>()
    var keyguardFlags = 0
    var inputMethods: List<String>? = null
    var thirdPartyKeyboardEnabled = false
    var accessibility: List<String>? = null
    val roles = mutableMapOf<String, RoleState>()
    val granted = mutableSetOf<String>()

    override fun hasPlayServices() = playServices
    override fun setFrpPolicy(accountIds: List<String>?) {
        if (frpUnsupported) throw UnsupportedOperationException("no FRP on this device")
        policyAccounts = accountIds
        policyWritten = true
    }
    override fun setLegacyFrpConfig(accountIds: List<String>?) {
        check(!legacyWriteRefused) { "managed configuration refused" }
        legacyFrp = accountIds
        legacyFrpSet = true
    }
    override fun notifyFrpChanged() { broadcasts++ }
    override fun accountTypes() = accounts
    override fun setUserControlDisabled(packages: List<String>) { noUserControl = packages }
    override fun extraUsers() = users.toList()
    override fun removeUser(user: ExtraUser): Boolean {
        if (user.id in unremovable) return false
        users.remove(user)
        return true
    }
    override fun setKeyguardDisabledFeatures(flags: Int) { keyguardFlags = flags }
    override fun setPermittedInputMethods(packages: List<String>?): Boolean {
        if (packages != null && thirdPartyKeyboardEnabled) return false
        inputMethods = packages
        return true
    }
    override fun setPermittedAccessibilityServices(packages: List<String>?): Boolean {
        accessibility = packages
        return true
    }
    override fun roleState(role: String) = roles[role] ?: RoleState.HELD
    override fun grantOwnPermission(permission: String): Boolean { granted += permission; return true }
}
