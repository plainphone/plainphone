// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.os.UserManager
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class HardeningTest {
    private val controls = FakeHardening()
    private val withAccount = PolicyConfig(frpAccountIds = setOf("118000000000000000001"))

    private fun apply(hardening: Hardening, config: PolicyConfig): List<StepResult> =
        listOf(hardening.resetProtection(config.frpAccountIds)) + hardening.applyOtherPolicies()

    private fun step(results: List<StepResult>, name: String) = results.single { it.name == name }

    @Test
    fun `Android 11+ sets the FRP policy and tells Play services`() {
        val results = apply(Hardening(controls, 30), withAccount)
        assertThat(controls.policyAccounts).containsExactly("118000000000000000001")
        assertThat(controls.legacyFrpSet).isFalse()
        assertThat(controls.broadcasts).isEqualTo(1)
        assertThat(Hardening.resetProtectionState(results)).isEqualTo(ResetProtection.ON)
    }

    @Test
    fun `Android 10 writes the Play services configuration and tells Play services`() {
        val results = apply(Hardening(controls, 29), withAccount)
        assertThat(controls.legacyFrp).containsExactly("118000000000000000001")
        assertThat(controls.policyWritten).isFalse()
        assertThat(controls.broadcasts).isEqualTo(1)
        assertThat(step(results, Hardening.RESET_PROTECTION).ok).isTrue()
    }

    @Test
    fun `no account clears the policy, so removing it in the dashboard takes effect`() {
        val h = Hardening(controls, 33)
        apply(h, withAccount)
        val results = apply(h, PolicyConfig())
        assertThat(controls.policyWritten).isTrue()
        assertThat(controls.policyAccounts).isNull()
        assertThat(controls.broadcasts).isEqualTo(2)
        assertThat(Hardening.resetProtectionState(results)).isEqualTo(ResetProtection.OFF)
    }

    @Test
    fun `Android 10 restores normal FRP when the last account is removed`() {
        val h = Hardening(controls, 29)
        apply(h, withAccount)
        assertThat(h.resetProtection(emptySet()).ok).isTrue()
        assertThat(controls.legacyFrp).isEmpty()
        assertThat(controls.broadcasts).isEqualTo(2)
    }

    @Test
    fun `refused Android 10 FRP cleanup reports failure`() {
        val h = Hardening(controls, 29)
        apply(h, withAccount)
        controls.legacyWriteRefused = true
        val result = h.resetProtection(emptySet())
        assertThat(result.ok).isFalse()
        assertThat(Hardening.resetProtectionState(listOf(result))).isEqualTo(ResetProtection.FAILED)
        assertThat(controls.legacyFrp).containsExactly("118000000000000000001")
        assertThat(controls.broadcasts).isEqualTo(1)
    }

    @Test
    fun `failing to notify Play services after clearing FRP reports failure`() {
        for (sdk in listOf(29, 30)) {
            val hardening = Hardening(object : HardeningControls by controls {
                override fun notifyFrpChanged() = throw SecurityException("broadcast refused")
            }, sdk)
            val result = hardening.resetProtection(emptySet())
            assertThat(result.ok).isFalse()
            assertThat(Hardening.resetProtectionState(listOf(result))).isEqualTo(ResetProtection.FAILED)
        }
    }

    @Test
    fun `account IDs that are not numbers are never sent`() {
        apply(Hardening(controls, 34), PolicyConfig(frpAccountIds = setOf("parent@example.org", "42")))
        assertThat(controls.policyAccounts).containsExactly("42")
    }

    @Test
    fun `no Play services fails only when a parent asked for protection`() {
        controls.playServices = false
        val off = apply(Hardening(controls, 34), PolicyConfig())
        assertThat(step(off, Hardening.RESET_PROTECTION).ok).isTrue()
        assertThat(Hardening.resetProtectionState(off)).isEqualTo(ResetProtection.NO_PLAY_SERVICES)
        val asked = apply(Hardening(controls, 34), withAccount)
        assertThat(step(asked, Hardening.RESET_PROTECTION).ok).isFalse()
        assertThat(Hardening.resetProtectionState(asked)).isEqualTo(ResetProtection.NO_PLAY_SERVICES)
        assertThat(controls.broadcasts).isEqualTo(0)
    }

    @Test
    fun `a device without FRP support fails the step when accounts are set`() {
        controls.frpUnsupported = true
        val results = apply(Hardening(controls, 34), withAccount)
        assertThat(step(results, Hardening.RESET_PROTECTION).ok).isFalse()
        assertThat(Hardening.resetProtectionState(results)).isEqualTo(ResetProtection.FAILED)
        // Without accounts there is nothing to protect, so nothing fails.
        assertThat(step(apply(Hardening(controls, 34), PolicyConfig()), Hardening.RESET_PROTECTION).ok).isTrue()
    }

    @Test
    fun `release clears FRP on both paths`() {
        apply(Hardening(controls, 29), withAccount)
        Hardening(controls, 29).release()
        assertThat(controls.legacyFrp).isNull()
        apply(Hardening(controls, 31), withAccount)
        Hardening(controls, 31).release()
        assertThat(controls.policyAccounts).isNull()
    }

    @Test
    fun `account types are reported without names`() {
        controls.accounts += listOf("com.google", "com.oneplus.account", "com.google")
        val results = apply(Hardening(controls, 29), PolicyConfig())
        assertThat(Hardening.accountTypes(results)).containsExactly("com.google", "com.oneplus.account").inOrder()
        controls.accounts.clear()
        assertThat(Hardening.accountTypes(apply(Hardening(controls, 29), PolicyConfig()))).isEmpty()
    }

    @Test
    fun `adding accounts is blocked in strong mode and lifted with the rest`() {
        for (sdk in 29..37) assertThat(LockPolicy.restrictions(sdk)).contains(UserManager.DISALLOW_MODIFY_ACCOUNTS)
        val device = FakeDevice()
        val applier = PolicyApplier(device, MemoryHiddenStore(), 29, Hardening(controls, 29))
        applier.apply(PolicyConfig())
        assertThat(device.restrictions).contains(UserManager.DISALLOW_MODIFY_ACCOUNTS)
        applier.lift()
        assertThat(device.restrictions).doesNotContain(UserManager.DISALLOW_MODIFY_ACCOUNTS)
        applier.apply(PolicyConfig())
        assertThat(device.restrictions).contains(UserManager.DISALLOW_MODIFY_ACCOUNTS)
    }

    @Test
    fun `Plainphone cannot be force stopped from Android 11, cleared on release`() {
        val results = apply(Hardening(controls, 30), PolicyConfig())
        assertThat(step(results, Hardening.NO_FORCE_STOP).ok).isTrue()
        assertThat(controls.noUserControl).containsExactly("org.plainphone.app")
        Hardening(controls, 30).release()
        assertThat(controls.noUserControl).isEmpty()
    }

    @Test
    fun `Android 10 keeps today's behaviour for force stop`() {
        val results = apply(Hardening(controls, 29), PolicyConfig())
        assertThat(results.map { it.name }).doesNotContain(Hardening.NO_FORCE_STOP)
        assertThat(controls.noUserControl).isEmpty()
    }

    @Test
    fun `no extra users is fine`() {
        assertThat(step(apply(Hardening(controls, 29), PolicyConfig()), Hardening.EXTRA_USERS).detail).isEqualTo("none")
    }

    @Test
    fun `an extra user or clone profile is removed`() {
        controls.users += listOf(ExtraUser(999, "profile"), ExtraUser(10, "user"))
        val s = step(apply(Hardening(controls, 29), PolicyConfig()), Hardening.EXTRA_USERS)
        assertThat(s.ok).isFalse()
        assertThat(s.detail).isEqualTo("extra profile present; removed 2")
        assertThat(controls.users).isEmpty()
    }

    @Test
    fun `an extra user Android refuses to remove breaks the lock, with counts only`() {
        controls.users += listOf(ExtraUser(999, "profile"), ExtraUser(10, "user"))
        controls.unremovable += 999
        val s = step(apply(Hardening(controls, 29), PolicyConfig()), Hardening.EXTRA_USERS)
        assertThat(s.ok).isFalse()
        assertThat(s.detail).contains("1 of 2")
        assertThat(s.detail).contains("1 profile")
        assertThat(s.detail).doesNotContain("999")
    }

    @Test
    fun `screen reading assistants are restricted per Android version`() {
        for (sdk in 29..37) {
            assertThat(LockPolicy.restrictions(sdk)).containsAtLeast(
                UserManager.DISALLOW_CONTENT_CAPTURE,
                UserManager.DISALLOW_CONTENT_SUGGESTIONS,
            )
        }
        for (sdk in 29..34) assertThat(LockPolicy.restrictions(sdk)).doesNotContain(UserManager.DISALLOW_ASSIST_CONTENT)
        assertThat(LockPolicy.restrictions(35)).contains(UserManager.DISALLOW_ASSIST_CONTENT)
    }

    @Test
    fun `lock screen widgets, keyboards and accessibility are limited to built-in ones`() {
        val results = apply(Hardening(controls, 29), PolicyConfig())
        assertThat(controls.keyguardFlags).isEqualTo(Hardening.KEYGUARD_DISABLE_WIDGETS_ALL)
        assertThat(controls.inputMethods).isEmpty()
        assertThat(controls.accessibility).isEmpty()
        assertThat(results.filterNot { it.ok }).isEmpty()
        Hardening(controls, 29).release()
        assertThat(controls.keyguardFlags).isEqualTo(0)
        assertThat(controls.inputMethods).isNull()
        assertThat(controls.accessibility).isNull()
    }

    @Test
    fun `an enabled keyboard from an app is reported as its own failed step`() {
        controls.thirdPartyKeyboardEnabled = true
        val results = apply(Hardening(controls, 29), PolicyConfig())
        assertThat(results.filterNot { it.ok }.map { it.name }).containsExactly(Hardening.KEYBOARDS)
    }

    @Test
    fun `Android 10 to 13 need the call screening and redirection roles, Android 14 does not`() {
        controls.roles[Hardening.ROLE_CALL_REDIRECTION] = RoleState.NOT_HELD
        val old = apply(Hardening(controls, 33), PolicyConfig())
        assertThat(step(old, Hardening.CALL_SCREENING_ROLE).ok).isTrue()
        assertThat(step(old, Hardening.CALL_REDIRECTION_ROLE).ok).isFalse()
        assertThat(controls.granted).contains(Hardening.READ_CONTACTS)
        val new = apply(Hardening(controls, 34), PolicyConfig())
        assertThat(new.map { it.name }).containsNoneOf(Hardening.CALL_SCREENING_ROLE, Hardening.CALL_REDIRECTION_ROLE, Hardening.CONTACTS_PERMISSION)
    }

    @Test
    fun `a role the phone does not offer does not break the lock`() {
        controls.roles[Hardening.ROLE_CALL_REDIRECTION] = RoleState.UNAVAILABLE
        assertThat(step(apply(Hardening(controls, 29), PolicyConfig()), Hardening.CALL_REDIRECTION_ROLE).ok).isTrue()
    }

    @Test
    fun `roles are asked phone app first, then the two extra roles, once each`() {
        val state = mutableMapOf(
            Hardening.ROLE_CALL_SCREENING to RoleState.NOT_HELD,
            Hardening.ROLE_CALL_REDIRECTION to RoleState.NOT_HELD,
        )
        val asked = mutableSetOf<String>()
        fun next(needsDialer: Boolean, sdk: Int = 31) =
            Hardening.nextRoleToRequest(sdk, needsDialer, { state[it] ?: RoleState.HELD }, asked)?.also { asked += it }
        assertThat(next(needsDialer = true)).isEqualTo(Hardening.ROLE_DIALER)
        // Declined: nothing else is asked during this visit.
        assertThat(next(needsDialer = true)).isNull()
        asked.clear()
        assertThat(next(needsDialer = false)).isEqualTo(Hardening.ROLE_CALL_SCREENING)
        state[Hardening.ROLE_CALL_SCREENING] = RoleState.HELD
        assertThat(next(needsDialer = false)).isEqualTo(Hardening.ROLE_CALL_REDIRECTION)
        assertThat(next(needsDialer = false)).isNull()
        asked.clear()
        assertThat(next(needsDialer = false, sdk = 34)).isNull()
    }
}
