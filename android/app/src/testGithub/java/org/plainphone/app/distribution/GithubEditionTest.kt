// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.distribution

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.light.LightSetup
import org.plainphone.app.light.Protections
import org.plainphone.app.sync.AndroidSyncDevice
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** The GitHub edition keeps both device admin receivers and reports itself as `github` (docs/play/play-edition.md). */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class GithubEditionTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()

    @Test fun `the GitHub build keeps its device admins and says github`() {
        val receivers = context.packageManager.getPackageInfo(context.packageName, PackageManager.GET_RECEIVERS).receivers.orEmpty()
        assertThat(receivers.filter { it.permission == Manifest.permission.BIND_DEVICE_ADMIN }.map { it.name })
            .containsExactly("org.plainphone.app.PlainphoneAdminReceiver", "org.plainphone.app.light.LightAdminReceiver")
        assertThat(LightSetup.steps()).contains(LightSetup.Step.ADMIN)
        assertThat(LightSetup.isDone(context, LightSetup.Step.ADMIN)).isFalse()
        assertThat(Protections.read(context, null, needsUsageAccess = false).toMap()).containsEntry("deviceAdmin", false)
        assertThat(AndroidSyncDevice(context).distribution()).isEqualTo("github")
    }
}
