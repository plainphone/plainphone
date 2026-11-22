// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.distribution

import android.Manifest
import android.app.NotificationManager
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.test.core.app.ApplicationProvider
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ListenableWorker
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.TestWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import com.google.common.truth.Truth.assertThat
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.plainphone.app.light.SetupAudience
import org.plainphone.app.sync.PlainphoneApiReleaseTest.PairedStore
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.update.PrefsUpdateStateStore
import org.plainphone.app.update.SelfUpdate
import org.plainphone.app.update.SelfUpdater
import org.plainphone.app.update.UpdateReport
import org.plainphone.app.update.UpdateWorker
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

/** What the Play edition leaves out and adds (docs/play/play-edition.md), checked on the merged play manifest. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35])
class PlayEditionTest {
    private val context = ApplicationProvider.getApplicationContext<Context>()
    private val pm get() = context.packageManager

    @Before fun workManager() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
    }

    @Test fun `there is no self-updater`() {
        PrefsUpdateStateStore(context).report = UpdateReport(SelfUpdater.STATE_PROMPTED, null, 1L, "9.9.9", promptedVersionCode = 999)
        // A prompt left by a GitHub build is never shown, and the dashboard's "Update now" starts nothing.
        assertThat(SelfUpdate.report(context)).isNull()
        SelfUpdate.request(context, 1234L)
        assertThat(WorkManager.getInstance(context).getWorkInfosForUniqueWork("plainphone-update-now-1234").get()).isEmpty()
        assertThat(requested()).doesNotContain(Manifest.permission.REQUEST_INSTALL_PACKAGES)
    }

    @Test fun `update checks left behind by a GitHub build are cancelled and do nothing`() {
        val work = WorkManager.getInstance(context)
        val inherited = PeriodicWorkRequestBuilder<UpdateWorker>(6, TimeUnit.HOURS).build()
        work.enqueueUniquePeriodicWork("plainphone-update-periodic", ExistingPeriodicWorkPolicy.UPDATE, inherited).result.get()
        SelfUpdate.onStart(context)
        assertThat(work.getWorkInfoById(inherited.id).get()!!.state).isEqualTo(WorkInfo.State.CANCELLED)
        val worker = TestWorkerBuilder<UpdateWorker>(context, Executors.newSingleThreadExecutor()).build()
        assertThat(worker.doWork()).isEqualTo(ListenableWorker.Result.success())
        assertThat(PrefsUpdateStateStore(context).report).isNull()
    }

    @Test fun `the Play build offers no Device Owner setup`() {
        for (action in listOf(DevicePolicyManager.ACTION_GET_PROVISIONING_MODE, DevicePolicyManager.ACTION_ADMIN_POLICY_COMPLIANCE)) {
            assertThat(pm.queryIntentActivities(Intent(action).setPackage(context.packageName), 0)).isEmpty()
        }
        assertThat(pm.queryIntentActivities(Intent(DevicePolicyManager.ACTION_PROVISIONING_SUCCESSFUL).setPackage(context.packageName), 0))
            .isEmpty()
        assertThat(requested()).doesNotContain(Manifest.permission.FOREGROUND_SERVICE_SYSTEM_EXEMPTED)
    }

    @Test fun `only the Child profile is offered`() {
        assertThat(SetupAudience.offered()).containsExactly(SetupAudience.CHILD, SetupAudience.PARENT).inOrder()
        assertThat(Distribution.MYSELF_PROFILE).isFalse()
    }

    @Test fun `the manifest declares a child monitoring tool and no broad package visibility`() {
        val meta = pm.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
        assertThat(meta.getString("isMonitoringTool")).isEqualTo("child_monitoring")
        assertThat(requested()).doesNotContain(Manifest.permission.QUERY_ALL_PACKAGES)
    }

    @Test
    @Config(shadows = [PairedStore::class], instrumentedPackages = ["org.plainphone.app.sync"])
    fun `a paired phone shows a quiet notice that cannot be dismissed for good`() {
        val nm = context.getSystemService(NotificationManager::class.java)
        MonitoringNotice.update(context)
        val notice = shadowOf(nm).getNotification(MonitoringNotice.ID)
        assertThat(notice.channelId).isEqualTo(MonitoringNotice.CHANNEL)
        assertThat(notice.flags and android.app.Notification.FLAG_ONGOING_EVENT).isNotEqualTo(0)
        assertThat(nm.getNotificationChannel(MonitoringNotice.CHANNEL).importance).isEqualTo(NotificationManager.IMPORTANCE_LOW)
        assertThat(notice.contentIntent).isNotNull()

        // Swiped away: the delete intent puts it straight back.
        nm.cancel(MonitoringNotice.ID)
        MonitoringNoticeReceiver().onReceive(context, Intent())
        assertThat(shadowOf(nm).getNotification(MonitoringNotice.ID)).isNotNull()

        // Released: Plainphone no longer looks after the phone, so the notice goes.
        SyncStore(context).markReleased()
        Distribution.onStateChanged(context)
        assertThat(shadowOf(nm).getNotification(MonitoringNotice.ID)).isNull()
    }

    @Test fun `an unpaired phone shows no notice`() {
        Distribution.onStateChanged(context)
        assertThat(shadowOf(context.getSystemService(NotificationManager::class.java)).getNotification(MonitoringNotice.ID)).isNull()
    }

    private fun requested(): List<String> =
        pm.getPackageInfo(context.packageName, PackageManager.GET_PERMISSIONS).requestedPermissions.orEmpty().toList()
}
