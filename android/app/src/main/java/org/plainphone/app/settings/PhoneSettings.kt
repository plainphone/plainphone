// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.settings

import org.json.JSONObject

/**
 * Phone settings the parent sets from the dashboard (docs/phone-settings.md). Pure data, parsed
 * from the `settings` object of the rules document; a missing key means [Mode.FREE].
 */
enum class Mode(val wire: String) {
    /** The child decides. Plainphone does not touch the setting. */
    FREE("free"),

    /** Plainphone sets the value once, each time the parent changes it. */
    PRESET("preset"),

    /** Plainphone sets the value and blocks the setting in Android's Settings. */
    LOCKED("locked"),
    ;

    companion object {
        fun of(wire: String): Mode? = entries.firstOrNull { it.wire == wire }
    }
}

data class PhoneSetting(val mode: Mode, val value: String? = null)

/** The settings in the catalog, with the modes each one supports. */
enum class SettingKey(val wire: String, val modes: Set<Mode>) {
    BLUETOOTH("bluetooth", LOCK_ONLY),
    WIFI("wifi", LOCK_ONLY),
    MOBILE_NETWORKS("mobileNetworks", LOCK_ONLY),
    ROAMING("roaming", LOCK_ONLY),
    LOCATION("location", ALL),
    CAMERA("camera", LOCK_ONLY),
    SCREEN_CAPTURE("screenCapture", LOCK_ONLY),
    SCREEN_TIMEOUT("screenTimeout", ALL),
    BRIGHTNESS("brightness", ALL),
    VOLUME("volume", ALL),
    WALLPAPER("wallpaper", LOCK_ONLY),
    LANGUAGE("language", LOCK_ONLY),
    TETHERING("tethering", LOCK_ONLY),
    NFC("nfc", LOCK_ONLY),
    AIRPLANE_MODE("airplaneMode", LOCK_ONLY),
    ;

    companion object {
        fun of(wire: String): SettingKey? = entries.firstOrNull { it.wire == wire }
    }
}

private val LOCK_ONLY = setOf(Mode.FREE, Mode.LOCKED)
private val ALL = setOf(Mode.FREE, Mode.PRESET, Mode.LOCKED)

/** The parent's settings for this phone. Only non-free settings are stored. */
data class PhoneSettings(val values: Map<SettingKey, PhoneSetting> = emptyMap()) {

    operator fun get(key: SettingKey): PhoneSetting = values[key] ?: FREE_SETTING

    fun isLocked(key: SettingKey) = get(key).mode == Mode.LOCKED

    /** Stable text for the lock fingerprint: re-apply when any setting changes. */
    fun canonical(): String = values.entries
        .sortedBy { it.key.wire }
        .joinToString(";") { (k, s) -> "${k.wire}=${s.mode.wire}:${s.value.orEmpty()}" }

    companion object {
        val NONE = PhoneSettings()
        private val FREE_SETTING = PhoneSetting(Mode.FREE)
        private val TIMEOUTS = setOf(15, 30, 60, 120, 300, 600)

        /**
         * Parses the `settings` object. Unknown keys (a newer server), unsupported modes and bad
         * values are skipped one by one: one odd setting must never throw away the whole rules document.
         */
        fun parse(json: JSONObject?): PhoneSettings {
            if (json == null) return NONE
            val out = mutableMapOf<SettingKey, PhoneSetting>()
            for (name in json.keys()) {
                val key = SettingKey.of(name) ?: continue
                val o = json.optJSONObject(name) ?: continue
                val mode = Mode.of(o.optString("mode")) ?: continue
                if (mode == Mode.FREE || mode !in key.modes) continue
                val raw = if (o.has("value") && !o.isNull("value")) o.get("value").toString() else null
                val value = normalize(key, mode, raw) ?: continue
                out[key] = PhoneSetting(mode, value.ifEmpty { null })
            }
            return PhoneSettings(out)
        }

        /** The value as the phone uses it, "" for settings without a value, or null if it is not valid. */
        fun normalize(key: SettingKey, mode: Mode, raw: String?): String? = when (key) {
            SettingKey.BLUETOOTH -> raw.takeIf { it == "off" || it == "noNewDevices" }
            SettingKey.WIFI, SettingKey.MOBILE_NETWORKS, SettingKey.LANGUAGE -> ""
            SettingKey.ROAMING, SettingKey.CAMERA, SettingKey.SCREEN_CAPTURE, SettingKey.TETHERING,
            SettingKey.NFC, SettingKey.AIRPLANE_MODE -> raw.takeIf { it == "off" }
            SettingKey.WALLPAPER -> raw.takeIf { it == "plainphone" }
            SettingKey.LOCATION -> raw.takeIf { it == "on" || it == "off" }
            SettingKey.SCREEN_TIMEOUT -> raw?.toIntOrNull()?.takeIf { it in TIMEOUTS }?.toString()
            SettingKey.BRIGHTNESS -> if (raw == "auto") raw else raw?.toIntOrNull()?.takeIf { it in 10..100 }?.toString()
            SettingKey.VOLUME -> if (mode == Mode.LOCKED) {
                raw.takeIf { it == "muted" }
            } else {
                raw?.toIntOrNull()?.takeIf { it in 0..100 }?.toString()
            }
        }
    }
}
