// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.home

import android.content.ComponentName
import android.content.Context
import android.content.pm.PackageManager
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment

@RunWith(RobolectricTestRunner::class)
class HomeGuardTest {
    private val context: Context = RuntimeEnvironment.getApplication()
    private val home = ComponentName(context, HomeActivity::class.java)

    @Test
    fun `a home screen that fails to draw three times lets go on the next start`() {
        HomeGuard.onAppStart(context)
        repeat(HomeGuard.MAX_FAILED_STARTS) { assertThat(HomeGuard.starting(context)).isTrue() }
        // The fourth start comes after three crashes: it must not draw, and Android gets the maker's launcher.
        assertThat(HomeGuard.starting(context)).isFalse()
        assertThat(HomeGuard.isEnabled(context)).isFalse()
        assertThat(context.packageManager.getComponentEnabledSetting(home)).isEqualTo(PackageManager.COMPONENT_ENABLED_STATE_DISABLED)
        assertThat(HomeGuard.blockReason(context)).isNotNull()
    }

    @Test
    fun `a start that draws resets the count`() {
        HomeGuard.onAppStart(context)
        repeat(10) {
            assertThat(HomeGuard.starting(context)).isTrue()
            HomeGuard.drawn(context)
        }
        assertThat(HomeGuard.isEnabled(context)).isTrue()
    }

    @Test
    fun `a new version gets a fresh chance`() {
        HomeGuard.onAppStart(context)
        repeat(HomeGuard.MAX_FAILED_STARTS + 1) { HomeGuard.starting(context) }
        assertThat(HomeGuard.isEnabled(context)).isFalse()
        // An update: the stored version no longer matches.
        context.getSharedPreferences("plainphone_home", Context.MODE_PRIVATE).edit().putLong("version", -2L).commit()
        HomeGuard.onAppStart(context)
        assertThat(HomeGuard.isEnabled(context)).isTrue()
        assertThat(HomeGuard.starting(context)).isTrue()
    }

    @Test
    fun `a maintenance unlock gives the home screen a fresh chance`() {
        HomeGuard.onAppStart(context)
        repeat(HomeGuard.MAX_FAILED_STARTS + 1) { HomeGuard.starting(context) }
        HomeGuard.reset(context)
        assertThat(HomeGuard.isEnabled(context)).isTrue()
        assertThat(HomeGuard.blockReason(context)).isNull()
    }
}
