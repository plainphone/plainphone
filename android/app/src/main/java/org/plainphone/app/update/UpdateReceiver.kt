// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import android.util.Log
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import org.plainphone.app.Lock

/**
 * Two jobs: hands the installer's answer for a session to the waiting [AndroidUpdateHost.install],
 * and applies the lock when an install lease expires (in case its holder died).
 */
class UpdateReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            ACTION_STATUS -> {
                val id = intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID, -1)
                val status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE)
                val message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE)
                Log.i("Plainphone", "self-update session $id: status $status ${message.orEmpty()}")
                waiting[id]?.complete(Result(status, message))
            }
            ACTION_LEASE_EXPIRED -> {
                val pending = goAsync()
                Lock.recoverInstallAsync(context) { pending.finish() }
            }
        }
    }

    data class Result(val status: Int, val message: String?)

    class Waiter {
        private val latch = CountDownLatch(1)
        @Volatile private var result: Result? = null
        fun complete(r: Result) {
            result = r
            latch.countDown()
        }
        fun await(time: Long, unit: TimeUnit): Result? = if (latch.await(time, unit)) result else null
    }

    companion object {
        const val ACTION_STATUS = "org.plainphone.app.UPDATE_STATUS"
        const val ACTION_LEASE_EXPIRED = "org.plainphone.app.INSTALL_LEASE_EXPIRED"
        private val waiting = ConcurrentHashMap<Int, Waiter>()

        fun expect(sessionId: Int): Waiter = Waiter().also { waiting[sessionId] = it }
        fun forget(sessionId: Int) {
            waiting.remove(sessionId)
        }

        /** The installer fills in the status extras, so this PendingIntent must be mutable (explicit component). */
        fun statusIntent(context: Context, sessionId: Int): PendingIntent = PendingIntent.getBroadcast(
            context,
            sessionId,
            Intent(context, UpdateReceiver::class.java).setAction(ACTION_STATUS),
            PendingIntent.FLAG_UPDATE_CURRENT or if (Build.VERSION.SDK_INT >= 31) PendingIntent.FLAG_MUTABLE else 0,
        )

        fun canScheduleExactExpiry(context: Context): Boolean =
            Build.VERSION.SDK_INT < 31 ||
                context.getSystemService(AlarmManager::class.java)?.canScheduleExactAlarms() == true

        fun scheduleLeaseExpiry(context: Context, holder: String, atMs: Long) {
            val alarms = checkNotNull(context.getSystemService(AlarmManager::class.java))
            val intent = leaseExpiryIntent(context, holder)
            if (org.plainphone.app.light.Mode.isStrong(context)) {
                check(canScheduleExactExpiry(context)) { "Enable Alarms & reminders for Plainphone to open an install window" }
                alarms.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, atMs, intent)
            } else {
                alarms.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, atMs, intent)
            }
        }

        fun cancelLeaseExpiry(context: Context, holder: String) {
            context.getSystemService(AlarmManager::class.java)?.cancel(leaseExpiryIntent(context, holder))
        }

        private fun leaseExpiryIntent(context: Context, holder: String): PendingIntent = PendingIntent.getBroadcast(
            context,
            3,
            Intent(context, UpdateReceiver::class.java).setAction(ACTION_LEASE_EXPIRED)
                .setData(android.net.Uri.fromParts("plainphone", holder, null)),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
    }
}
