// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.Application
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Looper
import androidx.test.core.app.ApplicationProvider
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.WorkQuery
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import java.time.Duration
import java.util.concurrent.TimeUnit
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.PlainphoneApplication
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SyncWorkBudgetTest {
    @Test
    fun `boot and repeated sync triggers keep a single periodic and immediate sync`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val manager = WorkManager.getInstance(context)
        val app = PlainphoneApplication()
        ReflectionHelpers.callInstanceMethod<Unit>(
            app, "attach", ReflectionHelpers.ClassParameter.from(Context::class.java, context),
        )
        val store = SyncStore(context, FakeSecretBox())
        app.onCreate()
        store.savePaired("phone", "test-token")

        // The real boot receiver delegates sync scheduling to this entry point.
        SyncScheduler.onBoot(context)
        val now = System.currentTimeMillis()
        store.finishAppScan(checkNotNull(store.appScanGeneration(now)), "test-inventory", now)
        assertThat(store.appScanGeneration(now)).isNull()
        fun checkBudget() {
            val jobs = manager.getWorkInfos(WorkQuery.fromTags(listOf(SyncWorker::class.java.name)))
                .get(5, TimeUnit.SECONDS).filterNot { it.state.isFinished }
            val periodic = jobs.filter { it.periodicityInfo != null }
            assertThat(periodic).hasSize(1)
            assertThat(periodic.single().periodicityInfo!!.repeatIntervalMillis)
                .isAtLeast(Duration.ofMinutes(15).toMillis())
            assertThat(jobs.count { it.periodicityInfo == null && it.state == WorkInfo.State.ENQUEUED })
                .isAtMost(1)
        }
        checkBudget()
        val immediate = manager.getWorkInfosForUniqueWork("plainphone-sync-now").get(5, TimeUnit.SECONDS)
        assertThat(immediate.filterNot { it.state.isFinished }).hasSize(1)
        for (intent in listOf(
            Intent(Intent.ACTION_SCREEN_ON),
            Intent(Intent.ACTION_SCREEN_OFF),
            Intent(Intent.ACTION_PACKAGE_ADDED, Uri.parse("package:org.example.app")),
        )) {
            context.sendBroadcast(intent)
            shadowOf(Looper.getMainLooper()).idle()
            checkBudget()
        }
        assertThat(store.appScanGeneration(now)).isNotNull()
    }
}
