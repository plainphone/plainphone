// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import android.app.Application
import android.app.NotificationManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.sync.ServerRules
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class AlwaysSharingNotificationTest {
    @Test
    fun `unchanged sharing rules keep the existing ongoing notification`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val manager = context.getSystemService(NotificationManager::class.java)!!
        Safety.createChannels(context)
        val rules = ServerRules.parse(
            """{"phoneId":"test","profile":"child","timezone":"UTC","apps":{"allowed":[],"hidden":[]},
               "dns":{},"contacts":[],"schedules":[],"location":{"enabled":true,"mode":"always"}}""",
        )
        Safety.onRules(context, rules, 1_800_000_000_000L)
        val first = manager.activeNotifications.single().notification
        Safety.onRules(context, rules, 1_800_000_001_000L)
        assertThat(manager.activeNotifications.single().notification).isSameInstanceAs(first)
    }
}
