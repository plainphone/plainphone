// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.safety

import android.app.Notification
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.AudioManager
import android.media.MediaPlayer
import android.media.RingtoneManager
import android.os.Build
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.VibrationAttributes
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager
import android.util.Log
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.plainphone.app.R
import org.plainphone.app.sync.RingRequest
import org.plainphone.app.sync.SafetyEvent
import org.plainphone.app.sync.SyncScheduler

/** What the ring screen shows. */
data class RingUi(val id: String, val endsAtMs: Long, val stopOnAnswer: Boolean, val answered: Boolean)

/**
 * "Ring the phone": the alarm sound at full volume on the alarm stream (it plays on silent, and
 * through do not disturb unless alarms are blocked there too), plus vibration, for at most
 * [MAX_MS]. The old alarm volume is put back afterwards, also after a crash (next start).
 */
class RingService : Service() {
    private val main = Handler(Looper.getMainLooper())
    private var player: MediaPlayer? = null
    private var vibrator: Vibrator? = null
    private val timeout = Runnable { finish("time is up") }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_STOP) {
            finish("stopped")
            return START_NOT_STICKY
        }
        val id = intent?.getStringExtra(EXTRA_ID) ?: return START_NOT_STICKY.also { stopSelf() }
        val now = System.currentTimeMillis()
        // Never longer than 5 minutes from now, whatever the server's clock says.
        val endsAt = minOf(intent.getLongExtra(EXTRA_ENDS_AT, now + MAX_MS), now + MAX_MS)
        val stopOnAnswer = intent.getBooleanExtra(EXTRA_STOP_ON_ANSWER, true)
        val answered = SafetyStore(this).ringAnswered(id)
        val current = _state.value
        if (!startInForeground(id)) return START_NOT_STICKY
        if (current?.id != id) {
            _state.value = RingUi(id, endsAt, stopOnAnswer, answered)
            SafetyStore(this).add(SafetyEvent(id, "shown"))
            SyncScheduler.now(this, "ringing")
            startSound()
            main.removeCallbacks(timeout)
            main.postDelayed(timeout, (endsAt - now).coerceAtLeast(1_000L))
            openScreen()
        }
        return START_NOT_STICKY
    }

    private fun startInForeground(id: String): Boolean {
        val open = PendingIntent.getActivity(
            this, Safety.ID_RING,
            Intent(this, RingActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val n = Notification.Builder(this, Safety.CHANNEL_RING)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.ring_title))
            .setContentText(getString(R.string.ring_notice))
            .setCategory(Notification.CATEGORY_ALARM)
            .setContentIntent(open)
            .setFullScreenIntent(open, true)
            .setOngoing(true)
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 29) {
                startForeground(Safety.ID_RING, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK)
            } else {
                startForeground(Safety.ID_RING, n)
            }
        } catch (e: Exception) {
            // Android would kill a service started with startForegroundService that is not in the
            // foreground. Leave the full-screen notice (it still opens the ring screen) and stop.
            Log.w(TAG, "ring could not start in the foreground: ${e.message}")
            getSystemService(NotificationManager::class.java)?.notify(Safety.ID_RING, n)
            stopSelf()
            return false
        }
        Log.i(TAG, "ringing for request $id")
        return true
    }

    private fun openScreen() {
        runCatching { startActivity(Intent(this, RingActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }
            .onFailure { Log.i(TAG, "ring screen via full-screen notification only: ${it.message}") }
    }

    private fun startSound() {
        val audio = getSystemService(AudioManager::class.java)
        val store = SafetyStore(this)
        if (audio != null) {
            if (store.savedAlarmVolume == null) store.savedAlarmVolume = audio.getStreamVolume(AudioManager.STREAM_ALARM)
            runCatching { audio.setStreamVolume(AudioManager.STREAM_ALARM, audio.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0) }
                .onFailure { Log.w(TAG, "could not raise the alarm volume: ${it.message}") }
        }
        val attrs = AudioAttributes.Builder()
            .setUsage(AudioAttributes.USAGE_ALARM)
            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
            .build()
        val uri = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM)
            ?: RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
        player?.release()
        player = runCatching {
            MediaPlayer().apply {
                setAudioAttributes(attrs)
                setDataSource(this@RingService, uri)
                isLooping = true
                prepare()
                start()
            }
        }.onFailure { Log.w(TAG, "alarm sound failed: ${it.message}") }.getOrNull()

        val v = if (Build.VERSION.SDK_INT >= 31) {
            getSystemService(VibratorManager::class.java)?.defaultVibrator
        } else {
            @Suppress("DEPRECATION") getSystemService(Vibrator::class.java)
        }
        vibrator = v
        val pattern = VibrationEffect.createWaveform(longArrayOf(0, 800, 600), 0)
        runCatching {
            if (Build.VERSION.SDK_INT >= 33) {
                v?.vibrate(pattern, VibrationAttributes.createForUsage(VibrationAttributes.USAGE_ALARM))
            } else {
                @Suppress("DEPRECATION") v?.vibrate(pattern, attrs)
            }
        }
    }

    /** "I'm here": tells the parent; the sound stops unless the parent chose the full 5 minutes. */
    private fun answer() {
        val ui = _state.value ?: return
        SafetyStore(this).markRingAnswered(ui.id)
        SafetyStore(this).add(SafetyEvent(ui.id, "here"))
        SyncScheduler.now(this, "ring answered")
        _state.value = ui.copy(answered = true)
        if (ui.stopOnAnswer) finish("answered")
    }

    private fun finish(why: String) {
        main.removeCallbacks(timeout)
        _state.value?.let { SafetyStore(this).markRingFinished(it.id) }
        _state.value = null
        player?.runCatching { stop(); release() }
        player = null
        vibrator?.cancel()
        restoreVolume(this)
        stopForeground(STOP_FOREGROUND_REMOVE)
        getSystemService(NotificationManager::class.java)?.cancel(Safety.ID_RING)
        Log.i(TAG, "ring ended: $why")
        stopSelf()
    }

    override fun onDestroy() {
        if (_state.value != null) finish("service destroyed")
        super.onDestroy()
    }

    companion object {
        private const val TAG = "Plainphone"
        const val MAX_MS = 5 * 60_000L
        private const val ACTION_STOP = "org.plainphone.app.safety.STOP_RING"
        private const val EXTRA_ID = "id"
        private const val EXTRA_ENDS_AT = "endsAt"
        private const val EXTRA_STOP_ON_ANSWER = "stopOnAnswer"

        private val _state = MutableStateFlow<RingUi?>(null)
        val state: StateFlow<RingUi?> = _state

        fun start(context: Context, r: RingRequest) {
            if (_state.value?.id == r.id) return
            val i = Intent(context, RingService::class.java)
                .putExtra(EXTRA_ID, r.id)
                .putExtra(EXTRA_ENDS_AT, r.endsAt.toEpochMilli())
                .putExtra(EXTRA_STOP_ON_ANSWER, r.stopOnAnswer)
            try {
                context.startForegroundService(i)
            } catch (e: Exception) {
                Log.w(TAG, "could not start the ring: ${e.message}")
            }
        }

        /** Stops a ring that is playing (the parent stopped it, or it ended on the server). */
        fun stop(context: Context) {
            if (_state.value == null) {
                restoreVolume(context)
                return
            }
            runCatching { context.startService(Intent(context, RingService::class.java).setAction(ACTION_STOP)) }
        }

        /** Called by the ring screen's button. */
        fun answer(context: Context) {
            val id = _state.value?.id ?: return
            SafetyStore(context).markRingAnswered(id)
            instanceAnswer?.invoke()
        }

        private var instanceAnswer: (() -> Unit)? = null

        /** Puts the alarm volume back if a ring raised it (also after a crash mid-ring). */
        fun restoreVolume(context: Context) {
            val store = SafetyStore(context)
            val saved = store.savedAlarmVolume ?: return
            runCatching {
                context.getSystemService(AudioManager::class.java)?.setStreamVolume(AudioManager.STREAM_ALARM, saved, 0)
            }
            store.savedAlarmVolume = null
        }
    }

    override fun onCreate() {
        super.onCreate()
        instanceAnswer = { answer() }
    }
}
