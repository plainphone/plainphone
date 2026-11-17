// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import java.util.UUID
import java.util.concurrent.CompletableFuture
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import org.plainphone.app.Lock
import org.plainphone.app.R

/** Keeps the Device Owner lease deadline independent of the installer and policy executors. */
class InstallWatchdogService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private val timerThread = HandlerThread("Plainphone install watchdog")
    internal val timerLooper: Looper get() = timerThread.looper
    private lateinit var timer: Handler
    private var latestStartId = 0
    private val wakeLock by lazy {
        getSystemService(PowerManager::class.java)
            .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Plainphone:install-watchdog")
            .apply { setReferenceCounted(false) }
    }

    override fun onCreate() {
        super.onCreate()
        timerThread.start()
        timer = Handler(timerLooper)
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        latestStartId = startId
        val ticket = intent?.getStringExtra(EXTRA_TICKET)?.let(pending::get)
        try {
            val channel = NotificationChannel(CHANNEL, getString(R.string.channel_updates), NotificationManager.IMPORTANCE_LOW)
            getSystemService(NotificationManager::class.java).createNotificationChannel(channel)
            val title = if (ticket?.holder == InstallLease.CATALOG) R.string.install_watchdog_catalog
                else R.string.install_watchdog_update
            val notification = Notification.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.ic_lock_lock)
                .setContentTitle(getString(title))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .apply {
                    if (Build.VERSION.SDK_INT >= 31) {
                        setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE)
                    }
                }
                .build()
            // Older versions have no systemExempted type.
            val type = if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SYSTEM_EXEMPTED else 0
            startForeground(NOTIFICATION_ID, notification, type)
            active = this
            if (ticket == null) {
                timer.post { onDeadline(SystemClock.elapsedRealtime(), force = intent == null) }
            } else {
                val remaining = (ticket.deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0)
                // A bounded partial wake lock covers ordinary screen-off sleep. Android can
                // still suspend the process or ignore wake locks in deep idle.
                wakeLock.acquire(InstallLease.MAX_MS + 5_000L)
                check(timer.postDelayed({ onDeadline(ticket.deadline) }, remaining))
                ticket.ready.complete(Unit)
            }
        } catch (e: Exception) {
            ticket?.ready?.completeExceptionally(e)
            Log.e("Plainphone", "could not start install watchdog", e)
            Lock.recoverInstallAsync(this, force = true) { stopIfIdle() }
            if (active !== this) stopSelf(startId)
        }
        return START_STICKY
    }

    private fun onDeadline(deadline: Long, force: Boolean = false) {
        val remaining = deadline - SystemClock.elapsedRealtime()
        if (remaining > 0) {
            timer.postDelayed({ onDeadline(deadline, force) }, remaining)
            return
        }
        try {
            InstallLease.android(this).recover("install watchdog deadline", force)
            stopIfIdle()
        } catch (e: Exception) {
            Log.e("Plainphone", "install watchdog could not restore the restriction", e)
            timer.postDelayed({ onDeadline(deadline, force) }, 1_000L)
        }
    }

    private fun stopIfIdle() {
        main.post {
            if (pending.isEmpty() && !InstallLease.android(this).hasMarkers()) {
                stopSelfResult(latestStartId)
            }
        }
    }

    override fun onDestroy() {
        if (active === this) {
            active = null
            if (InstallLease.android(this).hasMarkers()) {
                Lock.recoverInstallAsync(this, "install watchdog stopped", force = true)
            }
        }
        main.removeCallbacksAndMessages(null)
        timer.removeCallbacksAndMessages(null)
        timerThread.quitSafely()
        if (wakeLock.isHeld) wakeLock.release()
        super.onDestroy()
    }

    private data class Ticket(val holder: String, val deadline: Long, val ready: CompletableFuture<Unit>)

    companion object {
        private const val CHANNEL = "install_watchdog"
        private const val NOTIFICATION_ID = 76
        private const val EXTRA_TICKET = "ticket"
        private val pending = ConcurrentHashMap<String, Ticket>()
        @Volatile private var active: InstallWatchdogService? = null

        /** A launch request alone is insufficient: the foreground service must acknowledge the timer. */
        fun <T> armed(context: Context, holder: String, deadline: Long, persist: () -> T): T {
            check(Looper.myLooper() != Looper.getMainLooper()) { "Install watchdog must be armed off the main thread" }
            val id = UUID.randomUUID().toString()
            val ticket = Ticket(holder, deadline, CompletableFuture())
            pending[id] = ticket
            try {
                val intent = Intent(context, InstallWatchdogService::class.java).putExtra(EXTRA_TICKET, id)
                checkNotNull(context.startForegroundService(intent))
                ticket.ready.get(5, TimeUnit.SECONDS)
                return persist()
            } finally {
                pending.remove(id)
                finished()
            }
        }

        fun finished() {
            active?.stopIfIdle()
        }
    }
}
