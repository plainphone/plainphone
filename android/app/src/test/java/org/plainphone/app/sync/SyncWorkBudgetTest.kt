// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.AlarmManager
import android.app.Application
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
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
import org.plainphone.app.safety.Safety
import org.plainphone.app.safety.SafetyAlarmReceiver
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.util.ReflectionHelpers

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = Application::class)
class SyncWorkBudgetTest {
    @Suppress("DEPRECATION") // Robolectric exposes the PendingIntent as a field.
    @Test
    fun `boot and repeated sync triggers keep a single periodic and immediate sync`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val manager = WorkManager.getInstance(context)
        val app = attachPlainphoneApplication(context)
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("phone", "test-token")
        // Robolectric has no Android Keystore. Seed the process cache as if the token had been opened.
        val prefs = context.getSharedPreferences(SyncStore.PREFS, Context.MODE_PRIVATE)
        val cacheType = Class.forName(SyncStore::class.java.name + "\$CachedToken")
        val cached = ReflectionHelpers.callConstructor(
            cacheType,
            ReflectionHelpers.ClassParameter.from(SharedPreferences::class.java, prefs),
            ReflectionHelpers.ClassParameter.from(String::class.java, prefs.getString("device_token", null)),
            ReflectionHelpers.ClassParameter.from(String::class.java, "test-token"),
        )
        ReflectionHelpers.setStaticField(SyncStore::class.java, "tokenCache", cached)

        val now = System.currentTimeMillis()
        recordCleanInventory(store, now)
        app.onCreate()
        assertThat(store.appScanGeneration(now, emptySet())).isNotNull()

        // The real boot receiver delegates sync scheduling to this entry point.
        SyncScheduler.onBoot(context)
        recordCleanInventory(store, now)
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
        fun checkImmediateSync() {
            val immediate = manager.getWorkInfosForUniqueWork("plainphone-sync-now").get(5, TimeUnit.SECONDS)
            assertThat(immediate.filterNot { it.state.isFinished }).hasSize(1)
        }
        fun broadcast(intent: Intent) {
            context.sendBroadcast(intent)
            shadowOf(Looper.getMainLooper()).idle()
            checkBudget()
        }
        fun clearImmediateSync() {
            manager.cancelUniqueWork("plainphone-sync-now").result.get(5, TimeUnit.SECONDS)
        }

        checkImmediateSync()
        clearImmediateSync()
        broadcast(Intent(Intent.ACTION_SCREEN_ON))
        checkImmediateSync()

        val alarmManager = context.getSystemService(AlarmManager::class.java)!!
        val alarms = shadowOf(alarmManager)
        val bootAlarm = alarms.scheduledAlarms.single()
        alarmManager.cancel(checkNotNull(bootAlarm.operation))
        assertThat(alarms.scheduledAlarms).isEmpty()
        broadcast(Intent(Intent.ACTION_SCREEN_OFF))
        val idleAlarm = alarms.scheduledAlarms.single()
        assertThat(shadowOf(checkNotNull(idleAlarm.operation)).savedIntent.getIntExtra(SafetyAlarmReceiver.EXTRA_KIND, -1))
            .isEqualTo(Safety.REQ_IDLE)

        clearImmediateSync()
        broadcast(Intent(Intent.ACTION_PACKAGE_ADDED, Uri.parse("package:org.example.app")))
        checkImmediateSync()
        assertThat(store.appScanGeneration(now, emptySet())).isNotNull()
    }

    @Test
    fun `package removal change and locale change each invalidate a clean inventory`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        attachPlainphoneApplication(context).onCreate()
        val store = SyncStore(context, FakeSecretBox())
        val now = System.currentTimeMillis()
        val packageUri = Uri.parse("package:org.example.app")
        val broadcasts = listOf(
            Intent(Intent.ACTION_PACKAGE_REMOVED, packageUri),
            Intent(Intent.ACTION_PACKAGE_CHANGED, packageUri),
            Intent(Intent.ACTION_LOCALE_CHANGED),
        )
        val invalidated = broadcasts.mapNotNull { intent ->
            recordCleanInventory(store, now)
            context.sendBroadcast(intent)
            shadowOf(Looper.getMainLooper()).idle()
            intent.action.takeIf { store.appScanGeneration(now, emptySet()) != null }
        }
        assertThat(invalidated).containsExactlyElementsIn(broadcasts.map { it.action })
    }

    @Test
    fun `a second push queues a sync after the first`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val manager = WorkManager.getInstance(context)
        SyncStore(context, FakeSecretBox()).savePaired("phone", "test-token")
        SyncScheduler.pushWake(context, "rules")
        SyncScheduler.pushWake(context, "rules")
        val jobs = manager.getWorkInfosForUniqueWork("plainphone-push-wake").get(5, TimeUnit.SECONDS)
        assertThat(jobs.map { it.state }).containsExactly(WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED)
    }

    @Test
    fun `a relock while the lifted report is syncing still queues a sync`() {
        val context = ApplicationProvider.getApplicationContext<Application>()
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        val manager = WorkManager.getInstance(context)
        SyncStore(context, FakeSecretBox()).savePaired("phone", "test-token")
        SyncScheduler.lockStateChanged(context, "Accounts allowed briefly")
        SyncScheduler.lockStateChanged(context, "account restriction back")
        val jobs = manager.getWorkInfosForUniqueWork("plainphone-sync-lock-state").get(5, TimeUnit.SECONDS)
        assertThat(jobs.map { it.state }).containsExactly(WorkInfo.State.ENQUEUED, WorkInfo.State.BLOCKED)
    }

    private fun recordCleanInventory(store: SyncStore, now: Long) {
        store.appScanGeneration(now, emptySet())?.let { store.finishAppScan(it, "test-inventory", now, emptySet()) }
        assertThat(store.appScanGeneration(now, emptySet())).isNull()
    }

    private fun attachPlainphoneApplication(context: Context): PlainphoneApplication =
        PlainphoneApplication().also { app ->
            ReflectionHelpers.callInstanceMethod<Unit>(
                app, "attach", ReflectionHelpers.ClassParameter.from(Context::class.java, context),
            )
        }
}
