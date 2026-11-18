// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.Context
import android.util.Log
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit
import org.plainphone.app.Lock

/** Backs up the expiry alarm even when the phone is offline or loses exact-alarm access. */
class InstallRecoveryWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result = try {
        Lock.recoverInstall(applicationContext, "install window deadline")
        val holder = inputData.getString(KEY_HOLDER)
        // WorkManager's delay and the lease use different clocks.
        if (holder != null && InstallLease.android(applicationContext).isOpen(holder)) Result.retry()
        else Result.success()
    } catch (e: Exception) {
        Log.e("Plainphone", "install window recovery failed", e)
        Result.retry()
    }

    companion object {
        internal const val KEY_HOLDER = "holder"

        fun schedule(context: Context, holder: String, delayMs: Long) {
            val request = OneTimeWorkRequestBuilder<InstallRecoveryWorker>()
                .setInputData(workDataOf(KEY_HOLDER to holder))
                .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
                .build()
            // Persist the backup before the lease can lift the restriction.
            WorkManager.getInstance(context).enqueue(request).result.get(5, TimeUnit.SECONDS)
        }
    }
}
