// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.light

import android.content.Context
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PolicyConfig
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.rulesJson
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/** Light mode cannot force automatic time, so a clock set by hand is a missing protection the parent sees. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class LightClockTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val school = """[{"id":"school","kind":"school","days":[1,2,3,4,5,6,7],"start":"08:00","end":"15:00","allowedPackages":[]}]"""

    private fun clockStep(autoTime: Int, schedules: String) = run {
        Settings.Global.putInt(context.contentResolver, Settings.Global.AUTO_TIME, autoTime)
        SyncStore(context).saveRules("test", rulesJson(schedules = schedules, timezone = "UTC"), 1_000_000L)
        LightLock.apply(context, PolicyConfig()).singleOrNull { it.name == "automatic date and time" }
    }

    @Test
    fun `a clock set by hand fails the step when school time depends on it`() {
        assertThat(clockStep(autoTime = 0, schedules = school)?.ok).isFalse()
    }

    @Test
    fun `automatic time passes the step`() {
        assertThat(clockStep(autoTime = 1, schedules = school)?.ok).isTrue()
    }

    @Test
    fun `without schedules or limits the clock is not reported`() {
        assertThat(clockStep(autoTime = 0, schedules = "[]")).isNull()
    }
}
