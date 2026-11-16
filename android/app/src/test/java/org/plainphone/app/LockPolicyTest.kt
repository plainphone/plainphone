// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app

import android.os.UserManager
import com.google.common.truth.Truth.assertThat
import org.junit.Test

class LockPolicyTest {

    @Test
    fun `strong mode restrictions cover every way out named in the spec`() {
        val r = LockPolicy.restrictions(34)
        assertThat(r).containsAtLeast(
            UserManager.DISALLOW_INSTALL_APPS,
            UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES,
            UserManager.DISALLOW_INSTALL_UNKNOWN_SOURCES_GLOBALLY,
            UserManager.DISALLOW_FACTORY_RESET,
            UserManager.DISALLOW_SAFE_BOOT,
            UserManager.DISALLOW_ADD_USER,
            UserManager.DISALLOW_DEBUGGING_FEATURES,
            UserManager.DISALLOW_CONFIG_PRIVATE_DNS,
            UserManager.DISALLOW_CONFIG_VPN,
            UserManager.DISALLOW_USB_FILE_TRANSFER,
        )
        assertThat(r).containsNoDuplicates()
    }

    @Test
    fun `private space restriction only from Android 15`() {
        assertThat(LockPolicy.restrictions(34)).doesNotContain(UserManager.DISALLOW_ADD_PRIVATE_PROFILE)
        assertThat(LockPolicy.restrictions(35)).contains(UserManager.DISALLOW_ADD_PRIVATE_PROFILE)
        assertThat(LockPolicy.restrictions(37)).contains(UserManager.DISALLOW_ADD_PRIVATE_PROFILE)
    }

    @Test
    fun `hide plan hides everything launchable that is not kept`() {
        val plan = LockPolicy.hidePlan(
            launchable = setOf("dialer", "tiktok", "camera", "game"),
            keep = setOf("dialer", "camera", "maps"),
            previouslyHidden = emptySet(),
        )
        assertThat(plan.hide).containsExactly("tiktok", "game")
        assertThat(plan.unhide).isEmpty()
    }

    @Test
    fun `hide plan shows apps that became allowed`() {
        val plan = LockPolicy.hidePlan(
            launchable = setOf("dialer", "spotify", "tiktok"),
            keep = setOf("dialer", "spotify"),
            previouslyHidden = setOf("spotify", "tiktok"),
        )
        assertThat(plan.hide).containsExactly("tiktok")
        assertThat(plan.unhide).containsExactly("spotify")
    }

    @Test
    fun `Chrome cannot bypass the DNS filter with its own DNS-over-HTTPS`() {
        assertThat(LockPolicy.chromeRestrictions["DnsOverHttpsMode"]).isEqualTo("off")
        assertThat(LockPolicy.chromeRestrictions["IncognitoModeAvailability"]).isEqualTo(1)
    }
}
