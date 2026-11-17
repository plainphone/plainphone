// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.app.admin.DevicePolicyManager

/**
 * The device-facing side of the hardening steps (factory reset protection, force-stop, accounts,
 * extra users, keyboards and accessibility). Kept apart from [DeviceControls] so the lock and the
 * hardening can grow independently. Faked in unit tests.
 */
interface HardeningControls {
    val ownPackage: String

    /** Google Play services is installed and enabled: it is what enforces FRP after a reset. */
    fun hasPlayServices(): Boolean

    /** Android 11+: `setFactoryResetProtectionPolicy`. Null clears it. Throws if the device has no FRP. */
    fun setFrpPolicy(accountIds: List<String>?)

    /**
     * Android 10: the documented legacy path, the `factoryResetProtectionAdmin` managed configuration
     * of `com.google.android.gms`. Null switches it off (`disableFactoryResetProtectionAdmin`).
     */
    fun setLegacyFrpConfig(accountIds: List<String>?)

    /** Sends `com.google.android.gms.auth.FRP_CONFIG_CHANGED` to Play services, so it picks up the change. */
    fun notifyFrpChanged()

    /** Account types signed in on the phone (`com.google`, a maker's account), no names. */
    fun accountTypes(): List<String>

    /** Android 11+: packages the user cannot force-stop or clear, and that are exempt from App Standby. */
    fun setUserControlDisabled(packages: List<String>)

    /** Users and profiles other than the one Plainphone runs in (clone profiles, Parallel Apps, guests). */
    fun extraUsers(): List<ExtraUser>

    /** Returns true when Android removed the user. */
    fun removeUser(user: ExtraUser): Boolean

    /** `setKeyguardDisabledFeatures`; 0 allows everything again. */
    fun setKeyguardDisabledFeatures(flags: Int)

    /** Null allows every keyboard; an empty list allows only the keyboards that came with the phone. */
    fun setPermittedInputMethods(packages: List<String>?): Boolean

    /** Null allows every accessibility service; an empty list allows only built-in ones. */
    fun setPermittedAccessibilityServices(packages: List<String>?): Boolean

    /** Whether Plainphone holds [role], and whether the phone offers it at all. */
    fun roleState(role: String): RoleState

    /** Grants one of Plainphone's own runtime permissions (Device Owner, no dialog). False if Android refused. */
    fun grantOwnPermission(permission: String): Boolean
}

enum class RoleState { HELD, NOT_HELD, UNAVAILABLE }

/** Another Android user or profile on the phone. [id] is opaque; [kind] is "user" or "profile". */
data class ExtraUser(val id: Int, val kind: String)

/** The state of factory reset protection as the parent's dashboard shows it. */
enum class ResetProtection(val wire: String) {
    /** The parent's Google account(s) protect the phone after a reset. */
    ON("on"),
    /** No account IDs set: Android's own FRP applies (only with a Google account on the phone). */
    OFF("off"),
    /** No Google Play services: nothing protects the phone after a reset. */
    NO_PLAY_SERVICES("no-play-services"),
    /** Account IDs are set, but Android or Play services refused them. */
    FAILED("failed"),
}

/**
 * Hardening steps on top of the lock in [PolicyApplier]. Every step is independent and reports
 * its own [StepResult], like the lock itself.
 */
class Hardening(private val controls: HardeningControls, private val sdkInt: Int) {

    fun applyOtherPolicies(): List<StepResult> = buildList {
        add(accounts())
        if (sdkInt >= 30) {
            add(step(NO_FORCE_STOP) { controls.setUserControlDisabled(listOf(controls.ownPackage)) })
        }
        add(extraUsers())
        // #24: Android 10 to 13 cannot lock the default phone app. These two roles keep calls filtered
        // when it is changed in Settings; Android 14+ locks the phone app with DISALLOW_CONFIG_DEFAULT_APPS.
        if (sdkInt < 34) {
            add(role(CALL_SCREENING_ROLE, ROLE_CALL_SCREENING))
            add(role(CALL_REDIRECTION_ROLE, ROLE_CALL_REDIRECTION))
            // Telecom only passes calls from numbers in the phone's contacts to a screening app that is not
            // the phone app when it can read contacts. Plainphone never reads them itself.
            add(step(CONTACTS_PERMISSION) { check(controls.grantOwnPermission(READ_CONTACTS)) { "refused" } })
        }
        add(step(LOCK_SCREEN_WIDGETS) { controls.setKeyguardDisabledFeatures(KEYGUARD_DISABLE_WIDGETS_ALL) })
        add(step(KEYBOARDS) { check(controls.setPermittedInputMethods(emptyList())) { "a keyboard from outside the phone is enabled" } })
        add(step(ACCESSIBILITY) {
            check(controls.setPermittedAccessibilityServices(emptyList())) { "an accessibility service from an app is enabled" }
        })
    }

    /** Permanent exit for a test phone: undo every hardening step. */
    fun release(): List<StepResult> = buildList {
        add(step("clear FRP policy") { setFrp(null) })
        if (sdkInt >= 30) add(step("allow force stop of Plainphone") { controls.setUserControlDisabled(emptyList()) })
        add(step("allow lock screen widgets") { controls.setKeyguardDisabledFeatures(0) })
        add(step("allow every keyboard") { controls.setPermittedInputMethods(null) })
        add(step("allow every accessibility service") { controls.setPermittedAccessibilityServices(null) })
    }

    /**
     * FRP (#19). Always written, also when the list is empty, so removing the parent's account in the
     * dashboard clears the policy on the next sync. Android 10 has no `setFactoryResetProtectionPolicy`
     * and uses Play services' managed configuration instead. Both paths end with the broadcast
     * Play services needs to pick up the change.
     */
    fun resetProtection(accountIds: Set<String>): StepResult {
        val ids = accountIds.filter { it.isNotBlank() && it.all(Char::isDigit) }.sorted()
        if (!controls.hasPlayServices()) {
            // Without Play services nobody enforces FRP; a configured account is then a broken promise.
            return StepResult(RESET_PROTECTION, ids.isEmpty(), "${ResetProtection.NO_PLAY_SERVICES.wire}: no Google Play services")
        }
        return try {
            setFrp(ids.ifEmpty { null })
            val path = if (sdkInt >= 30) "policy" else "Play services configuration (Android 10)"
            if (ids.isEmpty()) {
                StepResult(RESET_PROTECTION, true, "${ResetProtection.OFF.wire}: no parent account; Android's own FRP applies")
            } else {
                StepResult(RESET_PROTECTION, true, "${ResetProtection.ON.wire}: ${ids.size} account(s), $path")
            }
        } catch (e: Exception) {
            // Clearing is best effort: a device without FRP has nothing to clear.
            if (ids.isEmpty()) {
                StepResult(RESET_PROTECTION, true, "${ResetProtection.OFF.wire}: ${e.javaClass.simpleName}")
            } else {
                StepResult(RESET_PROTECTION, false, "${ResetProtection.FAILED.wire}: ${e.javaClass.simpleName}: ${e.message}")
            }
        }
    }

    private fun setFrp(ids: List<String>?) {
        if (sdkInt >= 30) controls.setFrpPolicy(ids) else controls.setLegacyFrpConfig(ids)
        controls.notifyFrpChanged()
    }

    /** #21: which account types exist. Informational; `DISALLOW_MODIFY_ACCOUNTS` is in [LockPolicy]. */
    private fun accounts(): StepResult = step(ACCOUNTS) {
        val types = controls.accountTypes().distinct().sorted()
        if (types.isEmpty()) "none" else types.joinToString(",")
    }

    /**
     * #25: Parallel Apps, Dual apps and similar create another user outside the hide plan.
     * Try to remove it; the step fails while one is left, so the parent sees the lock as broken.
     */
    private fun extraUsers(): StepResult = step(EXTRA_USERS) {
        val found = controls.extraUsers()
        if (found.isEmpty()) return@step "none"
        val left = found.filterNot { runCatching { controls.removeUser(it) }.getOrDefault(false) }
        if (left.isEmpty()) return StepResult(EXTRA_USERS, false, "extra profile present; removed ${found.size}")
        error("extra profile present; ${left.size} of ${found.size} could not be removed (${left.groupingBy { it.kind }.eachCount().entries.joinToString { "${it.value} ${it.key}" }})")
    }

    /** Fails until the role dialog was accepted on the phone (MainActivity asks), like the phone app itself. */
    private fun role(name: String, role: String): StepResult = when (runCatching { controls.roleState(role) }.getOrNull()) {
        RoleState.HELD -> StepResult(name, true, "held")
        RoleState.UNAVAILABLE -> StepResult(name, true, "not offered by this phone")
        else -> StepResult(name, false, "confirm Plainphone in the dialog on the phone")
    }

    private inline fun step(name: String, block: () -> Any?): StepResult = try {
        val out = block()
        StepResult(name, true, if (out is String) out else "")
    } catch (e: Exception) {
        StepResult(name, false, "${e.javaClass.simpleName}: ${e.message}")
    }

    companion object {
        const val RESET_PROTECTION = "factory reset protection"
        const val ACCOUNTS = "accounts on the phone"
        const val NO_FORCE_STOP = "no force stop of Plainphone"
        const val EXTRA_USERS = "extra users and profiles"
        const val LOCK_SCREEN_WIDGETS = "no lock screen widgets"
        const val KEYBOARDS = "only built-in keyboards"
        const val ACCESSIBILITY = "only built-in accessibility services"
        const val CALL_SCREENING_ROLE = "call screening role"
        const val CALL_REDIRECTION_ROLE = "call redirection role"
        const val CONTACTS_PERMISSION = "contacts permission for call screening"
        const val READ_CONTACTS = "android.permission.READ_CONTACTS"

        // RoleManager.ROLE_CALL_SCREENING / ROLE_CALL_REDIRECTION, as plain strings for the JVM tests.
        const val ROLE_CALL_SCREENING = "android.app.role.CALL_SCREENING"
        const val ROLE_CALL_REDIRECTION = "android.app.role.CALL_REDIRECTION"
        const val ROLE_DIALER = "android.app.role.DIALER"

        /**
         * The next role MainActivity should ask for with the system dialog, or null. The phone app comes
         * first (it covers both directions); the two extra roles follow on Android 10 to 13. Each role is
         * asked once per visit to the screen ([asked]).
         */
        fun nextRoleToRequest(sdkInt: Int, needsDialer: Boolean, state: (String) -> RoleState, asked: Set<String>): String? {
            if (needsDialer && ROLE_DIALER !in asked) return ROLE_DIALER
            if (needsDialer || sdkInt >= 34) return null
            return listOf(ROLE_CALL_SCREENING, ROLE_CALL_REDIRECTION)
                .firstOrNull { it !in asked && state(it) == RoleState.NOT_HELD }
        }

        /** The secure camera on the lock screen stays. */
        const val KEYGUARD_DISABLE_WIDGETS_ALL = DevicePolicyManager.KEYGUARD_DISABLE_WIDGETS_ALL

        /** Reads the reset protection state out of a lock run, for the dashboard. Null if the step did not run. */
        fun resetProtectionState(results: List<StepResult>): ResetProtection? {
            val r = results.firstOrNull { it.name == RESET_PROTECTION } ?: return null
            val tag = r.detail.substringBefore(':')
            return ResetProtection.entries.firstOrNull { it.wire == tag } ?: if (r.ok) null else ResetProtection.FAILED
        }

        /** The account types from a lock run ("com.google"), for the dashboard. */
        fun accountTypes(results: List<StepResult>): List<String>? {
            val r = results.firstOrNull { it.name == ACCOUNTS && it.ok } ?: return null
            return if (r.detail == "none") emptyList() else r.detail.split(',').filter { it.isNotEmpty() }
        }
    }
}
