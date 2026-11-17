// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.settings

import android.app.WallpaperManager
import android.app.admin.DevicePolicyManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Shader
import android.media.AudioManager
import org.plainphone.app.PlainphoneAdminReceiver
import org.plainphone.app.home.HomeActivity
import org.plainphone.app.home.HomeGuard

class AndroidSettingsControls(private val context: Context) : SettingsControls {
    private val dpm = context.getSystemService(DevicePolicyManager::class.java)
    private val admin = PlainphoneAdminReceiver.component(context)

    override fun setCameraDisabled(disabled: Boolean) = dpm.setCameraDisabled(admin, disabled)

    override fun setScreenCaptureDisabled(disabled: Boolean) = dpm.setScreenCaptureDisabled(admin, disabled)

    override fun setSystemSetting(name: String, value: String) = dpm.setSystemSetting(admin, name, value)

    override fun setVolumePercent(percent: Int) {
        val audio = context.getSystemService(AudioManager::class.java)
        val refused = mutableListOf<Int>()
        for (stream in intArrayOf(AudioManager.STREAM_RING, AudioManager.STREAM_NOTIFICATION, AudioManager.STREAM_MUSIC)) {
            val max = audio.getStreamMaxVolume(stream)
            // Do Not Disturb refuses ring and notification changes; the other streams still get set.
            runCatching { audio.setStreamVolume(stream, (max * percent + 50) / 100, 0) }.onFailure { refused += stream }
        }
        check(refused.isEmpty()) { "Android refused streams $refused (Do Not Disturb?)" }
    }

    override fun setPlainphoneWallpaper() {
        WallpaperManager.getInstance(context).setBitmap(calmWallpaper())
    }

    override fun setPlainphoneHome(enabled: Boolean): String {
        if (enabled) {
            HomeGuard.blockReason(context)?.let { reason ->
                dpm.clearPackagePersistentPreferredActivities(admin, context.packageName)
                // Waiting for setup is normal; a crashing home screen is a failure the parent should see.
                if (reason.startsWith("waiting")) return reason else error(reason)
            }
            val filter = IntentFilter(Intent.ACTION_MAIN).apply {
                addCategory(Intent.CATEGORY_HOME)
                addCategory(Intent.CATEGORY_DEFAULT)
            }
            dpm.addPersistentPreferredActivity(admin, filter, ComponentName(context, HomeActivity::class.java))
            return "Plainphone"
        }
        // Plainphone sets no other persistent preferred activity, so this only lets go of HOME.
        dpm.clearPackagePersistentPreferredActivities(admin, context.packageName)
        return "maker's launcher"
    }

    /** A quiet, dark green-grey wash: no picture, nothing to look at. */
    private fun calmWallpaper(): Bitmap {
        val w = 360
        val h = 780
        val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
        val paint = Paint().apply {
            shader = LinearGradient(0f, 0f, 0f, h.toFloat(), 0xFF26302C.toInt(), 0xFF121614.toInt(), Shader.TileMode.CLAMP)
        }
        Canvas(bmp).drawRect(0f, 0f, w.toFloat(), h.toFloat(), paint)
        return bmp
    }
}

class PrefsPresetStore(context: Context) : PresetStore {
    private val prefs = context.getSharedPreferences("plainphone_settings", Context.MODE_PRIVATE)
    override fun applied(key: SettingKey): String? = prefs.getString(key.wire, null)
    override fun save(key: SettingKey, value: String?) {
        prefs.edit().apply { if (value == null) remove(key.wire) else putString(key.wire, value) }.apply()
    }
}
