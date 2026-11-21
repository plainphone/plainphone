// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sos

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Settings
import android.util.Log
import androidx.work.Data
import androidx.work.ForegroundInfo
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import org.json.JSONObject
import org.plainphone.app.R

/**
 * Sends an SOS the moment it is confirmed (docs/latency.md). WorkManager alone may hold a job back
 * for Doze, app standby or its own scheduling; here the first attempt starts at once, in a short
 * foreground service with a visible "Sending" notification for an ordinary SOS, and quietly in the
 * app's process for a silent one (a notification would give it away). The WorkManager job stays the
 * safety net across restarts, and a new network retries a pending SOS at once instead of waiting
 * for its backoff.
 */
internal object SosSender {
    private const val TAG = "Plainphone"
    const val CHANNEL = "sos"
    const val NOTIFICATION_ID = 0x505

    /** Keys of the WorkManager input that are kept for a retry on a new network. */
    private val STRINGS = listOf("id", "phone", "kind", "trigger", "message")
    private val LONGS = listOf("at", "elapsed")

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val locks = ConcurrentHashMap<String, Mutex>()

    /** One attempt at a time per SOS, whoever runs it. */
    fun lockFor(id: String): Mutex = locks.getOrPut(id) { Mutex() }

    /** Starts the first attempt now. */
    fun sendNow(context: Context, input: Data, visible: Boolean) {
        val app = context.applicationContext
        if (visible && startService(app, input)) return
        runInProcess(app, input)
    }

    private fun startService(context: Context, input: Data): Boolean = try {
        context.startForegroundService(Intent(context, SosSendService::class.java).putExtra(EXTRA_JOB, toJson(input).toString()))
        true
    } catch (e: IllegalStateException) {
        // Android 12+ refuses a foreground service from the background (ForegroundServiceStartNotAllowedException).
        Log.w(TAG, "SOS send service not allowed, sending in the process", e)
        false
    } catch (e: SecurityException) {
        Log.w(TAG, "SOS send service not allowed, sending in the process", e)
        false
    }

    /** Without a service: a partial wake lock keeps the CPU up for the attempt. */
    fun runInProcess(context: Context, input: Data, done: () -> Unit = {}) {
        val lock = context.getSystemService(PowerManager::class.java)?.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Plainphone:sos-send")
        lock?.setReferenceCounted(false)
        lock?.acquire(WAKE_LOCK_MS)
        scope.launch {
            try {
                SosDelivery.attempt(context, input, 0)
            } catch (e: Exception) {
                Log.e(TAG, "SOS attempt failed; WorkManager retries", e)
            } finally {
                runCatching { lock?.release() }
                done()
            }
        }
    }

    /** A new network: try every SOS that is still waiting, now. WorkManager's own retry stays queued. */
    fun retryPending(context: Context) {
        val prefs = SosDelivery.prefs(context)
        for ((key, value) in prefs.all) {
            if (!key.startsWith("job:") || value !is String) continue
            val input = runCatching { fromJson(JSONObject(value)) }.getOrNull() ?: continue
            val id = input.getString("id") ?: continue
            // Running already (the press itself, or WorkManager): that attempt sees the network too.
            if (lockFor(id).isLocked) continue
            runInProcess(context.applicationContext, input)
        }
    }

    fun remember(prefs: SharedPreferences, input: Data) {
        val id = input.getString("id") ?: return
        prefs.edit().putString("job:$id", toJson(input).toString()).apply()
    }

    fun forget(prefs: SharedPreferences, id: String) {
        prefs.edit().remove("job:$id").apply()
        locks.remove(id)
    }

    /**
     * Milliseconds from the press to now on the monotonic clock, for the server's delivery timing.
     * Null after a reboot (the clock restarted) or for a job queued by an older version.
     */
    fun elapsedMs(context: Context, input: Data): Long? {
        val pressed = input.getLong("elapsed", -1)
        val boot = input.getInt("boot", -1)
        if (pressed < 0 || boot < 0 || boot != bootCount(context)) return null
        return (SystemClock.elapsedRealtime() - pressed).takeIf { it >= 0 }
    }

    fun bootCount(context: Context): Int =
        runCatching { Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT) }.getOrDefault(-1)

    private fun toJson(input: Data) = JSONObject().apply {
        STRINGS.forEach { key -> input.getString(key)?.let { put(key, it) } }
        LONGS.forEach { key -> (input.keyValueMap[key] as? Long)?.let { put(key, it) } }
        (input.keyValueMap["boot"] as? Int)?.let { put("boot", it) }
    }

    fun fromJson(json: JSONObject): Data = Data.Builder().apply {
        STRINGS.forEach { key -> if (json.has(key)) putString(key, json.getString(key)) }
        LONGS.forEach { key -> if (json.has(key)) putLong(key, json.getLong(key)) }
        if (json.has("boot")) putInt("boot", json.getInt("boot"))
    }.build()

    /** The SOS channel: high importance so it shows over everything, but silent; the alert is for the parents. */
    fun ensureChannel(context: Context) {
        val channel = NotificationChannel(CHANNEL, context.getString(R.string.sos_channel), NotificationManager.IMPORTANCE_HIGH).apply {
            setSound(null, null)
            enableVibration(false)
            lockscreenVisibility = Notification.VISIBILITY_PUBLIC
        }
        context.getSystemService(NotificationManager::class.java)?.createNotificationChannel(channel)
    }

    fun notification(context: Context): Notification {
        ensureChannel(context)
        return Notification.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_upload)
            .setContentTitle(context.getString(R.string.sos_sending))
            .setCategory(Notification.CATEGORY_STATUS)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .apply { if (Build.VERSION.SDK_INT >= 31) setForegroundServiceBehavior(Notification.FOREGROUND_SERVICE_IMMEDIATE) }
            .build()
    }

    fun foregroundInfo(context: Context): ForegroundInfo =
        if (Build.VERSION.SDK_INT >= 34) {
            ForegroundInfo(NOTIFICATION_ID, notification(context), ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
        } else {
            ForegroundInfo(NOTIFICATION_ID, notification(context))
        }

    const val EXTRA_JOB = "org.plainphone.app.sos.JOB"
    /** Longer than a whole attempt (2 s position, 4 s report, SMS hand-off), shorter than a short service may run. */
    const val WAKE_LOCK_MS = 60_000L
}

/**
 * The visible "Sending your SOS" while the first attempt runs. A short service: Android stops it
 * after three minutes at most, and it stops itself as soon as the attempt is over.
 */
class SosSendService : Service() {
    private var running = 0

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val job = intent?.getStringExtra(SosSender.EXTRA_JOB)?.let { runCatching { SosSender.fromJson(JSONObject(it)) }.getOrNull() }
        val foreground = try {
            val notification = SosSender.notification(this)
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(SosSender.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_SHORT_SERVICE)
            } else {
                startForeground(SosSender.NOTIFICATION_ID, notification)
            }
            true
        } catch (e: RuntimeException) {
            // Not allowed right now (ForegroundServiceStartNotAllowedException and friends): send without the notice.
            Log.w("Plainphone", "SOS send service could not go to the foreground", e)
            false
        }
        if (job == null || !foreground) {
            job?.let { SosSender.runInProcess(applicationContext, it) }
            if (running == 0) stopSelf(startId)
            return START_NOT_STICKY
        }
        running++
        SosSender.runInProcess(applicationContext, job) {
            android.os.Handler(mainLooper).post {
                if (--running == 0) {
                    stopForeground(STOP_FOREGROUND_REMOVE)
                    stopSelf()
                }
            }
        }
        // WorkManager owns the retry; a killed service is not restarted.
        return START_NOT_STICKY
    }

    // The attempt itself goes on in the process; only the notice ends.
    override fun onTimeout(startId: Int) = stopNotice()

    override fun onTimeout(startId: Int, fgsType: Int) = stopNotice()

    private fun stopNotice() {
        running = 0
        stopForeground(STOP_FOREGROUND_REMOVE)
        stopSelf()
    }
}
