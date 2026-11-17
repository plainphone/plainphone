// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.settings

import android.os.UserManager
import com.google.common.truth.Truth.assertThat
import org.junit.Test
import org.plainphone.app.FakeDevice
import org.plainphone.app.LockPolicy
import org.plainphone.app.MemoryHiddenStore
import org.plainphone.app.PolicyApplier
import org.plainphone.app.PolicyConfig
import org.plainphone.app.ServerOverlay

class FakeSettingsControls : SettingsControls {
    var cameraOff = false
    var screenCaptureOff = false
    val system = mutableMapOf<String, String>()
    val systemCalls = mutableListOf<String>()
    var volume: Int? = null
    var wallpapers = 0
    var home = false
    var failSystem = false

    override fun setCameraDisabled(disabled: Boolean) { cameraOff = disabled }
    override fun setScreenCaptureDisabled(disabled: Boolean) { screenCaptureOff = disabled }
    override fun setSystemSetting(name: String, value: String) {
        check(!failSystem) { "refused" }
        system[name] = value
        systemCalls += "$name=$value"
    }
    override fun setVolumePercent(percent: Int) { volume = percent }
    override fun setPlainphoneWallpaper() { wallpapers++ }
    override fun setPlainphoneHome(enabled: Boolean): String { home = enabled; return "ok" }
}

class MemoryPresetStore : PresetStore {
    val values = mutableMapOf<SettingKey, String>()
    override fun applied(key: SettingKey) = values[key]
    override fun save(key: SettingKey, value: String?) {
        if (value == null) values.remove(key) else values[key] = value
    }
}

class SettingsApplierTest {
    private val device = FakeDevice()
    private val controls = FakeSettingsControls()
    private val presets = MemoryPresetStore()
    private val settings = SettingsApplier(device, controls, presets, sdkInt = 35)

    private fun of(vararg pairs: Pair<SettingKey, PhoneSetting>) = PhoneSettings(mapOf(*pairs))

    @Test
    fun `the home screen is locked in on every run and let go on lift`() {
        settings.apply(PhoneSettings.NONE)
        assertThat(controls.home).isTrue()
        settings.lift()
        assertThat(controls.home).isFalse()
    }

    @Test
    fun `free settings touch nothing but clear what Plainphone set before`() {
        val locked = of(
            SettingKey.WIFI to PhoneSetting(Mode.LOCKED),
            SettingKey.CAMERA to PhoneSetting(Mode.LOCKED, "off"),
            SettingKey.BLUETOOTH to PhoneSetting(Mode.LOCKED, "noNewDevices"),
        )
        settings.apply(locked)
        assertThat(device.restrictions).containsExactly(
            UserManager.DISALLOW_CONFIG_WIFI,
            UserManager.DISALLOW_CONFIG_BLUETOOTH,
            UserManager.DISALLOW_BLUETOOTH_SHARING,
        )
        assertThat(controls.cameraOff).isTrue()

        val results = settings.apply(PhoneSettings.NONE)
        assertThat(results.filterNot { it.ok }).isEmpty()
        assertThat(device.restrictions).isEmpty()
        assertThat(controls.cameraOff).isFalse()
        assertThat(controls.systemCalls).isEmpty()
    }

    @Test
    fun `bluetooth off is a different restriction than no new devices`() {
        settings.apply(of(SettingKey.BLUETOOTH to PhoneSetting(Mode.LOCKED, "off")))
        assertThat(device.restrictions).containsExactly(UserManager.DISALLOW_BLUETOOTH)
        settings.apply(of(SettingKey.BLUETOOTH to PhoneSetting(Mode.LOCKED, "noNewDevices")))
        assertThat(device.restrictions).doesNotContain(UserManager.DISALLOW_BLUETOOTH)
    }

    @Test
    fun `a preset is set once per change, so the child can change it afterwards`() {
        val preset = of(SettingKey.SCREEN_TIMEOUT to PhoneSetting(Mode.PRESET, "60"))
        settings.apply(preset)
        settings.apply(preset)
        assertThat(controls.systemCalls).containsExactly("screen_off_timeout=60000")
        assertThat(device.restrictions).isEmpty()

        settings.apply(of(SettingKey.SCREEN_TIMEOUT to PhoneSetting(Mode.PRESET, "30")))
        assertThat(controls.systemCalls).containsExactly("screen_off_timeout=60000", "screen_off_timeout=30000").inOrder()

        // Back to free and then the same preset again: it is set again.
        settings.apply(PhoneSettings.NONE)
        settings.apply(of(SettingKey.SCREEN_TIMEOUT to PhoneSetting(Mode.PRESET, "30")))
        assertThat(controls.systemCalls).hasSize(3)
    }

    @Test
    fun `a locked value is set on every run and blocked in Settings`() {
        val locked = of(SettingKey.SCREEN_TIMEOUT to PhoneSetting(Mode.LOCKED, "30"))
        settings.apply(locked)
        settings.apply(locked)
        assertThat(controls.systemCalls).containsExactly("screen_off_timeout=30000", "screen_off_timeout=30000")
        assertThat(device.restrictions).containsExactly(UserManager.DISALLOW_CONFIG_SCREEN_TIMEOUT)
    }

    @Test
    fun `brightness as a percentage switches automatic brightness off`() {
        settings.apply(of(SettingKey.BRIGHTNESS to PhoneSetting(Mode.LOCKED, "40")))
        assertThat(controls.system).containsExactly("screen_brightness_mode", "0", "screen_brightness", "102")
        settings.apply(of(SettingKey.BRIGHTNESS to PhoneSetting(Mode.LOCKED, "auto")))
        assertThat(controls.system["screen_brightness_mode"]).isEqualTo("1")
        assertThat(SettingsApplier.brightnessLevel(100)).isEqualTo(255)
        assertThat(SettingsApplier.brightnessLevel(10)).isEqualTo(26)
    }

    @Test
    fun `volume preset sets the level, volume locked mutes through the restriction`() {
        settings.apply(of(SettingKey.VOLUME to PhoneSetting(Mode.PRESET, "70")))
        assertThat(controls.volume).isEqualTo(70)
        assertThat(device.restrictions).isEmpty()
        settings.apply(of(SettingKey.VOLUME to PhoneSetting(Mode.LOCKED, "muted")))
        assertThat(device.restrictions).containsExactly(UserManager.DISALLOW_ADJUST_VOLUME)
    }

    @Test
    fun `the wallpaper is set once and then only locked`() {
        val locked = of(SettingKey.WALLPAPER to PhoneSetting(Mode.LOCKED, "plainphone"))
        settings.apply(locked)
        settings.apply(locked)
        assertThat(controls.wallpapers).isEqualTo(1)
        assertThat(device.restrictions).containsExactly(UserManager.DISALLOW_SET_WALLPAPER)
    }

    @Test
    fun `NFC radio can only be switched off from Android 14`() {
        val nfc = of(SettingKey.NFC to PhoneSetting(Mode.LOCKED, "off"))
        @Suppress("DEPRECATION")
        assertThat(SettingsApplier.restrictionsFor(nfc, 33)).containsExactly(UserManager.DISALLOW_OUTGOING_BEAM)
        assertThat(SettingsApplier.restrictionsFor(nfc, 34)).contains(UserManager.DISALLOW_NEAR_FIELD_COMMUNICATION_RADIO)
        assertThat(SettingsApplier.managedRestrictions(33)).doesNotContain(UserManager.DISALLOW_NEAR_FIELD_COMMUNICATION_RADIO)
    }

    @Test
    fun `one failing setting does not stop the others`() {
        controls.failSystem = true
        val results = settings.apply(
            of(
                SettingKey.SCREEN_TIMEOUT to PhoneSetting(Mode.LOCKED, "30"),
                SettingKey.CAMERA to PhoneSetting(Mode.LOCKED, "off"),
            ),
        )
        assertThat(results.filterNot { it.ok }.map { it.name }).containsExactly("setting screenTimeout")
        // The restriction is set first, so the setting is blocked even though its value failed.
        assertThat(device.restrictions).contains(UserManager.DISALLOW_CONFIG_SCREEN_TIMEOUT)
        assertThat(controls.cameraOff).isTrue()
        // A failed preset is tried again next time.
        assertThat(presets.values).doesNotContainKey(SettingKey.SCREEN_TIMEOUT)
    }

    @Test
    fun `a location preset after a lock is applied again`() {
        settings.location(of(SettingKey.LOCATION to PhoneSetting(Mode.PRESET, "on")))
        settings.location(of(SettingKey.LOCATION to PhoneSetting(Mode.LOCKED, "off")))
        assertThat(device.locationOn).isFalse()
        settings.location(of(SettingKey.LOCATION to PhoneSetting(Mode.PRESET, "on")))
        assertThat(device.locationOn).isTrue()
    }

    @Test
    fun `a volume preset after silent is set again, and after the block is gone`() {
        settings.apply(of(SettingKey.VOLUME to PhoneSetting(Mode.PRESET, "60")))
        settings.apply(of(SettingKey.VOLUME to PhoneSetting(Mode.LOCKED, "muted")))
        controls.volume = null
        settings.apply(of(SettingKey.VOLUME to PhoneSetting(Mode.PRESET, "60")))
        assertThat(controls.volume).isEqualTo(60)
        assertThat(device.restrictions).doesNotContain(UserManager.DISALLOW_ADJUST_VOLUME)
    }

    @Test
    fun `lift gives every setting back`() {
        settings.apply(
            of(
                SettingKey.CAMERA to PhoneSetting(Mode.LOCKED, "off"),
                SettingKey.SCREEN_CAPTURE to PhoneSetting(Mode.LOCKED, "off"),
                SettingKey.AIRPLANE_MODE to PhoneSetting(Mode.LOCKED, "off"),
            ),
        )
        settings.lift()
        assertThat(device.restrictions).isEmpty()
        assertThat(controls.cameraOff).isFalse()
        assertThat(controls.screenCaptureOff).isFalse()
    }

    // --- Through PolicyApplier -------------------------------------------------------

    private val policy = PolicyApplier(device, MemoryHiddenStore(), 35, settings)
    private fun config(locationRequired: Boolean, s: PhoneSettings) =
        PolicyConfig(server = ServerOverlay(locationRequired = locationRequired, settings = s))

    @Test
    fun `location for Find always wins over the location setting`() {
        policy.apply(config(locationRequired = true, of(SettingKey.LOCATION to PhoneSetting(Mode.LOCKED, "off"))))
        assertThat(device.locationOn).isTrue()
        assertThat(device.restrictions).contains(LockPolicy.LOCATION_RESTRICTION)
    }

    @Test
    fun `location locked off without Find switches it off and blocks it`() {
        device.locationOn = true
        policy.apply(config(locationRequired = false, of(SettingKey.LOCATION to PhoneSetting(Mode.LOCKED, "off"))))
        assertThat(device.locationOn).isFalse()
        assertThat(device.restrictions).contains(LockPolicy.LOCATION_RESTRICTION)
    }

    @Test
    fun `location preset is set once and left free`() {
        policy.apply(config(locationRequired = false, of(SettingKey.LOCATION to PhoneSetting(Mode.PRESET, "on"))))
        assertThat(device.locationOn).isTrue()
        assertThat(device.restrictions).doesNotContain(LockPolicy.LOCATION_RESTRICTION)
        device.locationOn = false // the child switched it off
        policy.apply(config(locationRequired = false, of(SettingKey.LOCATION to PhoneSetting(Mode.PRESET, "on"))))
        assertThat(device.locationOn).isFalse()
    }

    @Test
    fun `the lock and the settings apply together, and lift clears both`() {
        val results = policy.apply(config(locationRequired = false, of(SettingKey.TETHERING to PhoneSetting(Mode.LOCKED, "off"))))
        assertThat(results.filterNot { it.ok }.map { it.name }).isEmpty()
        assertThat(device.restrictions).containsAtLeastElementsIn(LockPolicy.restrictions(35) + UserManager.DISALLOW_CONFIG_TETHERING)
        assertThat(controls.home).isTrue()
        policy.lift()
        assertThat(device.restrictions).isEmpty()
        assertThat(controls.home).isFalse()
    }

    @Test
    fun `release lets go of the home screen preference and gives up Device Owner`() {
        policy.apply(config(locationRequired = false, PhoneSettings.NONE))
        assertThat(controls.home).isTrue()
        val results = policy.release()
        assertThat(results.filterNot { it.ok }.map { it.name }).isEmpty()
        // Android would otherwise keep opening Plainphone's home screen after it is switched off.
        assertThat(controls.home).isFalse()
        assertThat(device.owner).isFalse()
    }
}
