// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.accounts.AccountManager
import android.app.admin.DevicePolicyManager
import android.app.admin.FactoryResetProtectionPolicy
import android.app.role.RoleManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.os.Process
import android.os.UserHandle
import android.os.UserManager
import androidx.annotation.RequiresApi
import org.plainphone.app.telephony.PlainphoneCallRedirectionService
import org.plainphone.app.telephony.PlainphoneCallScreeningService

class AndroidHardeningControls(private val context: Context) : HardeningControls {
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = PlainphoneAdminReceiver.component(context)

    override val ownPackage: String = context.packageName

    override fun hasPlayServices(): Boolean = runCatching {
        Compat.applicationInfo(context.packageManager, GMS_PACKAGE, 0).enabled
    }.getOrDefault(false)

    @RequiresApi(30)
    override fun setFrpPolicy(accountIds: List<String>?) {
        val policy = accountIds?.let {
            FactoryResetProtectionPolicy.Builder()
                .setFactoryResetProtectionAccounts(it)
                .setFactoryResetProtectionEnabled(true)
                .build()
        }
        // Throws UnsupportedOperationException on devices without FRP support.
        dpm.setFactoryResetProtectionPolicy(admin, policy)
    }

    override fun setLegacyFrpConfig(accountIds: List<String>?) {
        // https://developer.android.com/work/dpc/security#enable_enterprise_frp (devices that cannot use
        // setFactoryResetProtectionPolicy). Plainphone sets no other Play services configuration.
        val bundle = Bundle()
        if (!accountIds.isNullOrEmpty()) {
            bundle.putStringArray(KEY_FRP_ADMIN, accountIds.toTypedArray())
            bundle.putBoolean(KEY_FRP_DISABLE, false)
        } else if (accountIds == null) {
            bundle.putBoolean(KEY_FRP_DISABLE, true)
        }
        dpm.setApplicationRestrictions(admin, GMS_PACKAGE, bundle)
    }

    override fun notifyFrpChanged() {
        val intent = Intent(ACTION_FRP_CONFIG_CHANGED)
            .setPackage(GMS_PACKAGE)
            .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
        context.sendBroadcast(intent)
    }

    // Device Owner sees every account (AccountManagerService grants owners visibility), no permission needed.
    override fun accountTypes(): List<String> =
        AccountManager.get(context).accounts.map { it.type }

    @RequiresApi(30)
    override fun setUserControlDisabled(packages: List<String>) =
        dpm.setUserControlDisabledPackages(admin, packages)

    override fun extraUsers(): List<ExtraUser> {
        val um = context.getSystemService(UserManager::class.java)
        val profiles = um.userProfiles.filterNot(::isProtectedUser)
        val secondary = dpm.getSecondaryUsers(admin).orEmpty().filter { !isProtectedUser(it) && it !in profiles }
        return profiles.map { ExtraUser(id(it), "profile") } + secondary.map { ExtraUser(id(it), "user") }
    }

    override fun removeUser(user: ExtraUser): Boolean {
        // The first interactive user can be secondary when Device Owner lives in headless user 0.
        // The public API cannot identify that main user by handle, so report without removing.
        if (Build.VERSION.SDK_INT >= 31 && UserManager.isHeadlessSystemUserMode()) return false
        if (user.id < 0) return false
        val um = context.getSystemService(UserManager::class.java)
        val handle = (um.userProfiles + dpm.getSecondaryUsers(admin).orEmpty())
            .firstOrNull { !isProtectedUser(it) && id(it) == user.id } ?: return true
        return dpm.removeUser(admin, handle)
    }

    private fun isProtectedUser(handle: UserHandle): Boolean =
        handle == Process.myUserHandle() || handle == UserHandle.getUserHandleForUid(Process.SYSTEM_UID)

    override fun setKeyguardDisabledFeatures(flags: Int) = dpm.setKeyguardDisabledFeatures(admin, flags)

    override fun setPermittedInputMethods(packages: List<String>?): Boolean =
        dpm.setPermittedInputMethods(admin, packages)

    override fun setPermittedAccessibilityServices(packages: List<String>?): Boolean =
        dpm.setPermittedAccessibilityServices(admin, packages)

    override fun setCallRoleServicesEnabled(enabled: Boolean) {
        val pm = context.packageManager
        val state = if (enabled) PackageManager.COMPONENT_ENABLED_STATE_DEFAULT else PackageManager.COMPONENT_ENABLED_STATE_DISABLED
        for (service in listOf(PlainphoneCallScreeningService::class.java, PlainphoneCallRedirectionService::class.java)) {
            val component = ComponentName(context, service)
            if (pm.getComponentEnabledSetting(component) != state) {
                pm.setComponentEnabledSetting(component, state, PackageManager.DONT_KILL_APP)
            }
        }
    }

    override fun roleState(role: String): RoleState {
        val roles = context.getSystemService(RoleManager::class.java) ?: return RoleState.UNAVAILABLE
        return when {
            !roles.isRoleAvailable(role) -> RoleState.UNAVAILABLE
            roles.isRoleHeld(role) -> RoleState.HELD
            else -> RoleState.NOT_HELD
        }
    }

    override fun grantOwnPermission(permission: String): Boolean = dpm.setPermissionGrantState(
        admin, ownPackage, permission, DevicePolicyManager.PERMISSION_GRANT_STATE_GRANTED,
    )

    private fun id(handle: UserHandle): Int = context.getSystemService(UserManager::class.java).getSerialNumberForUser(handle).toInt()

    companion object {
        const val GMS_PACKAGE = "com.google.android.gms"
        const val ACTION_FRP_CONFIG_CHANGED = "com.google.android.gms.auth.FRP_CONFIG_CHANGED"
        const val KEY_FRP_ADMIN = "factoryResetProtectionAdmin"
        const val KEY_FRP_DISABLE = "disableFactoryResetProtectionAdmin"
    }
}
