// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.Application
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import java.util.concurrent.TimeUnit
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config

/**
 * Android 10 and 11 run expedited work as a foreground service and ask the worker for its
 * notification first. SyncWorker has none, so the "paired" sync failed there before it began
 * (emulator run 45006624811, API 29: IllegalStateException from Worker.getForegroundInfo).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29, 30, 35], application = Application::class)
class SyncNowWorkTest {
    @Test
    fun `the sync after pairing reaches the worker on every supported Android`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val manager = WorkManager.getInstance(context)
        SyncStore(context, FakeSecretBox()).savePaired("phone", "test-token")

        SyncScheduler.now(context, "paired")
        val queued = manager.getWorkInfosForUniqueWork("plainphone-sync-now").get(5, TimeUnit.SECONDS).single()
        checkNotNull(WorkManagerTestInitHelper.getTestDriver(context)).setAllConstraintsMet(queued.id)

        val ran = checkNotNull(manager.getWorkInfoById(queued.id).get(5, TimeUnit.SECONDS))
        // No server here, so the sync itself fails and asks to be retried. It must not fail as work.
        assertThat(ran.state).isNotEqualTo(WorkInfo.State.FAILED)
        assertThat(ran.runAttemptCount).isAtLeast(1)
    }
}
