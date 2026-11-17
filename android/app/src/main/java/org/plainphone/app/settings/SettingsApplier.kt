// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.settings

import android.annotation.SuppressLint
import android.os.UserManager
import org.plainphone.app.DeviceControls
import org.plainphone.app.LockPolicy
import org.plainphone.app.StepResult

/** The Device Owner calls behind the phone settings and the home screen. Faked in unit tests. */
interface SettingsControls {
    fun setCameraDisabled(disabled: Boolean)
    fun setScreenCaptureDisabled(disabled: Boolean)
    /** `Settings.System` via DevicePolicyManager.setSystemSetting (brightness and screen timeout only). */
    fun setSystemSetting(name: String, value: String)
    /** Ring, notification and media volume, as a share of each stream's maximum. */
    fun setVolumePercent(percent: Int)
    fun setPlainphoneWallpaper()
    /** Makes Plainphone's home screen the one Android always opens (persistent preferred HOME), or lets go of it. */
    fun setPlainphoneHome(enabled: Boolean)
}

/** Remembers which preset value was last applied, so a preset is set once and the child can change it after. */
interface PresetStore {
    fun applied(key: SettingKey): String?
    fun save(key: SettingKey, value: String?)
}

/**
 * Applies the parent's phone settings (docs/phone-settings.md) and locks Plainphone in as the home
 * screen. Like [org.plainphone.app.PolicyApplier], every step stands on its own.
 */
class SettingsApplier(
    private val device: DeviceControls,
    private val controls: SettingsControls,
    private val presets: PresetStore,
    private val sdkInt: Int,
) {

    fun apply(settings: PhoneSettings): List<StepResult> {
        val results = mutableListOf<StepResult>()
        results += step("home screen") { controls.setPlainphoneHome(true) }
        val wanted = restrictionsFor(settings, sdkInt)
        for (key in SettingKey.entries) {
            if (key == SettingKey.LOCATION) continue // see location(), it shares its restriction with "Find"
            val s = settings[key]
            if (s.mode == Mode.FREE) {
                if (presets.applied(key) != null) presets.save(key, null)
                continue
            }
            results += step("setting ${key.wire}") { applyOne(key, s, wanted) }
        }
        // Everything this module may have set before and is not wanted now.
        val free = managedRestrictions(sdkInt) - wanted
        results += step("phone settings left to the user") {
            free.forEach(device::clearRestriction)
            if (!settings.isLocked(SettingKey.CAMERA)) controls.setCameraDisabled(false)
            if (!settings.isLocked(SettingKey.SCREEN_CAPTURE)) controls.setScreenCaptureDisabled(false)
            "${free.size} free"
        }
        return results
    }

    /**
     * The location setting when the parent does not need location for "Find" (that case is
     * handled by PolicyApplier and always wins: location on and locked).
     */
    fun location(settings: PhoneSettings): List<StepResult> {
        val s = settings[SettingKey.LOCATION]
        return when (s.mode) {
            Mode.FREE -> {
                presets.save(SettingKey.LOCATION, null)
                listOf(step("location setting free") { device.clearRestriction(LockPolicy.LOCATION_RESTRICTION) })
            }
            Mode.PRESET -> listOf(
                step("setting location") {
                    device.clearRestriction(LockPolicy.LOCATION_RESTRICTION)
                    once(SettingKey.LOCATION, s.value) { device.setLocationEnabled(s.value == "on") }
                },
            )
            Mode.LOCKED -> listOf(
                step("setting location") {
                    device.setLocationEnabled(s.value == "on")
                    device.addRestriction(LockPolicy.LOCATION_RESTRICTION)
                },
            )
        }
    }

    /** Maintenance unlock and release: every setting back to the user, and the maker's launcher back. */
    fun lift(): List<StepResult> = listOf(
        step("clear phone settings") {
            managedRestrictions(sdkInt).forEach(device::clearRestriction)
            controls.setCameraDisabled(false)
            controls.setScreenCaptureDisabled(false)
        },
        step("let go of the home screen") { controls.setPlainphoneHome(false) },
    )

    private fun applyOne(key: SettingKey, s: PhoneSetting, wanted: Set<String>): String {
        // Restrictions first, so a locked setting is blocked even if setting its value fails.
        restrictionsOf(key, s, sdkInt).filter { it in wanted }.forEach(device::addRestriction)
        return when (key) {
            SettingKey.CAMERA -> { controls.setCameraDisabled(true); "camera off" }
            SettingKey.SCREEN_CAPTURE -> { controls.setScreenCaptureDisabled(true); "screenshots off" }
            SettingKey.SCREEN_TIMEOUT -> valueOnce(key, s) {
                controls.setSystemSetting(SCREEN_OFF_TIMEOUT, (s.value!!.toInt() * 1000).toString())
            }
            SettingKey.BRIGHTNESS -> valueOnce(key, s) {
                if (s.value == "auto") {
                    controls.setSystemSetting(SCREEN_BRIGHTNESS_MODE, "1")
                } else {
                    controls.setSystemSetting(SCREEN_BRIGHTNESS_MODE, "0")
                    controls.setSystemSetting(SCREEN_BRIGHTNESS, brightnessLevel(s.value!!.toInt()).toString())
                }
            }
            SettingKey.VOLUME -> if (s.mode == Mode.PRESET) {
                valueOnce(key, s) { controls.setVolumePercent(s.value!!.toInt()) }
            } else {
                "muted"
            }
            // Setting the same picture on every sync would only cost battery: once per change.
            SettingKey.WALLPAPER -> once(key, s.value) { controls.setPlainphoneWallpaper() }
            else -> "locked"
        }
    }

    /** Locked values are set on every run (the child cannot change them anyway); presets only once per change. */
    private fun valueOnce(key: SettingKey, s: PhoneSetting, set: () -> Unit): String =
        if (s.mode == Mode.LOCKED) {
            set()
            presets.save(key, s.value)
            "locked at ${s.value}"
        } else {
            once(key, s.value, set)
        }

    private fun once(key: SettingKey, value: String?, set: () -> Unit): String {
        if (presets.applied(key) == value) return "set earlier to $value"
        set()
        presets.save(key, value)
        return "set to $value"
    }

    private inline fun step(name: String, block: () -> Any?): StepResult = try {
        val out = block()
        StepResult(name, true, if (out is String) out else "")
    } catch (e: Exception) {
        StepResult(name, false, "${e.javaClass.simpleName}: ${e.message}")
    }

    companion object {
        // android.provider.Settings.System names, as plain strings so the class stays JVM-testable.
        const val SCREEN_OFF_TIMEOUT = "screen_off_timeout"
        const val SCREEN_BRIGHTNESS = "screen_brightness"
        const val SCREEN_BRIGHTNESS_MODE = "screen_brightness_mode"

        /** 10..100 % on Android's 0..255 scale. */
        fun brightnessLevel(percent: Int): Int = (percent.coerceIn(0, 100) * 255 + 50) / 100

        /** The user restrictions behind one setting, filtered to what [sdkInt] knows. */
        @SuppressLint("InlinedApi") // API 34 constant only added when sdkInt is high enough.
        @Suppress("DEPRECATION") // DISALLOW_OUTGOING_BEAM: Android Beam is gone, the constant still exists.
        fun restrictionsOf(key: SettingKey, s: PhoneSetting, sdkInt: Int): Set<String> {
            if (s.mode != Mode.LOCKED) return emptySet()
            return when (key) {
                SettingKey.BLUETOOTH -> if (s.value == "off") {
                    setOf(UserManager.DISALLOW_BLUETOOTH)
                } else {
                    setOf(UserManager.DISALLOW_CONFIG_BLUETOOTH, UserManager.DISALLOW_BLUETOOTH_SHARING)
                }
                SettingKey.WIFI -> setOf(UserManager.DISALLOW_CONFIG_WIFI)
                SettingKey.MOBILE_NETWORKS -> setOf(UserManager.DISALLOW_CONFIG_MOBILE_NETWORKS)
                SettingKey.ROAMING -> setOf(UserManager.DISALLOW_DATA_ROAMING)
                SettingKey.SCREEN_TIMEOUT -> setOf(UserManager.DISALLOW_CONFIG_SCREEN_TIMEOUT)
                SettingKey.BRIGHTNESS -> setOf(UserManager.DISALLOW_CONFIG_BRIGHTNESS)
                SettingKey.VOLUME -> setOf(UserManager.DISALLOW_ADJUST_VOLUME)
                SettingKey.WALLPAPER -> setOf(UserManager.DISALLOW_SET_WALLPAPER)
                SettingKey.LANGUAGE -> setOf(UserManager.DISALLOW_CONFIG_LOCALE)
                SettingKey.TETHERING -> setOf(UserManager.DISALLOW_CONFIG_TETHERING)
                SettingKey.NFC -> if (sdkInt >= 34) {
                    setOf(UserManager.DISALLOW_NEAR_FIELD_COMMUNICATION_RADIO, UserManager.DISALLOW_OUTGOING_BEAM)
                } else {
                    setOf(UserManager.DISALLOW_OUTGOING_BEAM)
                }
                SettingKey.AIRPLANE_MODE -> setOf(UserManager.DISALLOW_AIRPLANE_MODE)
                // Camera and screenshots are DevicePolicyManager calls; location is shared with "Find".
                SettingKey.CAMERA, SettingKey.SCREEN_CAPTURE, SettingKey.LOCATION -> emptySet()
            }
        }

        fun restrictionsFor(settings: PhoneSettings, sdkInt: Int): Set<String> =
            SettingKey.entries.flatMapTo(mutableSetOf()) { restrictionsOf(it, settings[it], sdkInt) }

        /** Every restriction this module can set, so the ones no longer wanted are cleared. */
        fun managedRestrictions(sdkInt: Int): Set<String> = SettingKey.entries.flatMapTo(mutableSetOf()) { key ->
            val values = when (key) {
                SettingKey.BLUETOOTH -> listOf("off", "noNewDevices")
                SettingKey.VOLUME -> listOf("muted")
                else -> listOf(null)
            }
            values.flatMap { restrictionsOf(key, PhoneSetting(Mode.LOCKED, it), sdkInt) }
        }
    }
}
