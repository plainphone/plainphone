// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.push

import android.app.BroadcastOptions
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.os.Binder
import android.os.Build
import java.util.UUID
import org.json.JSONObject
import org.plainphone.app.sync.SyncScheduler

private const val DISTRIBUTOR = "org.unifiedpush.android.distributor."
private const val CONNECTOR = "org.unifiedpush.android.connector."
private const val REGISTRATION_INTERVAL = 60 * 60 * 1000L

/** A single UnifiedPush registration, refreshed periodically while enabled. */
internal object UnifiedWake {
    private fun prefs(context: Context) = context.getSharedPreferences("push-distributor", Context.MODE_PRIVATE)

    fun endpoint(context: Context): String? {
        val state = prefs(context)
        val receivers = context.packageManager.queryBroadcastReceivers(Intent(DISTRIBUTOR + "REGISTER"), 0)
        val packages = receivers.map { it.activityInfo.packageName }.distinct().sorted()
        val previous = state.getString("package", null)
        val pkg = previous?.takeIf { it in packages }
            ?: packages.firstOrNull { it == "io.heckel.ntfy" }
            ?: packages.firstOrNull()
        if (pkg != previous) unregister(context)
        if (pkg == null) return null
        val token = state.getString("token", null) ?: UUID.randomUUID().toString()
        val now = System.currentTimeMillis()
        if (now - state.getLong("attempt", 0) >= REGISTRATION_INTERVAL) {
            val identity = PendingIntent.getBroadcast(context, 0,
                Intent().setComponent(ComponentName(context, UnifiedWakeReceiver::class.java)),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            state.edit().putString("package", pkg).putString("token", token).putLong("attempt", now).apply()
            send(context, Intent(DISTRIBUTOR + "REGISTER").setPackage(pkg)
                .putExtra("token", token).putExtra("pi", identity))
        }
        return state.getString("endpoint", null)
    }

    fun unregister(context: Context) {
        val state = prefs(context)
        val pkg = state.getString("package", null) ?: return
        send(context, Intent(DISTRIBUTOR + "UNREGISTER").setPackage(pkg).putExtra("token", state.getString("token", null)))
        state.edit().clear().apply()
    }

    private fun send(context: Context, intent: Intent) {
        if (Build.VERSION.SDK_INT >= 34) {
            context.sendBroadcast(intent, null, BroadcastOptions.makeBasic().setShareIdentityEnabled(true).toBundle())
        } else context.sendBroadcast(intent)
    }

    fun receive(context: Context, intent: Intent, sender: String?) {
        val state = prefs(context)
        val pkg = state.getString("package", null) ?: return
        val token = state.getString("token", null) ?: return
        if (sender != null && sender != pkg || intent.getStringExtra("token") != token) return
        intent.getStringExtra("id")?.let { id ->
            send(context, Intent(DISTRIBUTOR + "MESSAGE_ACK").setPackage(pkg).putExtra("token", token).putExtra("id", id))
        }
        when (intent.action) {
            CONNECTOR + "NEW_ENDPOINT" -> {
                val endpoint = intent.getStringExtra("endpoint") ?: return
                if (state.getString("endpoint", null) == endpoint) return
                state.edit().putString("endpoint", endpoint).apply()
                SyncScheduler.pushRegistrationChanged(context)
            }
            CONNECTOR + "UNREGISTERED", CONNECTOR + "TEMP_UNAVAILABLE", CONNECTOR + "REGISTRATION_FAILED" -> {
                val hadEndpoint = state.contains("endpoint")
                if (intent.action == CONNECTOR + "REGISTRATION_FAILED" && hadEndpoint) return
                val edit = state.edit().remove("endpoint")
                if (intent.action != CONNECTOR + "TEMP_UNAVAILABLE") edit.putString("token", UUID.randomUUID().toString())
                edit.apply()
                if (hadEndpoint) SyncScheduler.pushRegistrationChanged(context)
            }
            CONNECTOR + "MESSAGE" -> {
                val message = intent.getByteArrayExtra("bytesMessage")?.takeIf { it.size <= 100 }?.decodeToString()
                    ?: intent.getStringExtra("message")?.takeIf { it.length <= 100 } ?: return
                val reason = runCatching { JSONObject(message).optString("wake") }.getOrNull()
                PhoneWake.receive(context, "unifiedpush", reason)
            }
        }
    }
}

class UnifiedWakeReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val sender = if (Build.VERSION.SDK_INT >= 34) sentFromPackage else null
        UnifiedWake.receive(context, intent, sender)
    }
}

class UnifiedWakeService : Service() {
    override fun onBind(intent: Intent) = Binder()
}
