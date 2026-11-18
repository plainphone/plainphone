// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.time

import android.app.Application
import android.content.Intent
import android.os.Looper
import android.os.PowerManager
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class TimeTickerTest {
    @Test
    fun `registration while the screen is off waits for screen on`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        val main = shadowOf(Looper.getMainLooper())
        shadowOf(context.getSystemService(PowerManager::class.java)!!).turnScreenOn(false)
        main.idle()
        TimeTicker.register(context)
        assertThat(main.isIdle).isTrue()
        assertThat(main.nextScheduledTaskTime.toMillis()).isEqualTo(0L)

        context.sendBroadcast(Intent(Intent.ACTION_SCREEN_ON))
        main.idle()
        assertThat(main.nextScheduledTaskTime.toMillis()).isGreaterThan(0L)
    }
}
