// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.Manifest
import android.annotation.SuppressLint
import android.app.admin.DevicePolicyManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.net.VpnService
import android.os.Build
import android.os.SystemClock
import android.provider.Settings
import java.security.SecureRandom
import org.plainphone.app.batteryExemptionRequest
import org.plainphone.app.ConfigStore
import org.plainphone.app.MaintenancePin
import org.plainphone.app.R
import org.plainphone.app.sync.SetupCompletion
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.Lock
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.time.TimeGuard

/**
 * The light-mode setup, one step per screen (docs/light-mode.md). A step is done when Android
 * says so, so the list heals itself: if the child switches something off, Plainphone asks again.
 */
object LightSetup {
    private const val PREFS = "plainphone_light_setup"

    enum class Step(val title: Int, val body: Int, val action: Int, val optional: Boolean = false) {
        PIN(R.string.light_step_pin_title, R.string.light_step_pin_body, R.string.light_step_pin_action),
        PAIR(R.string.light_step_pair_title, R.string.light_step_pair_body, R.string.light_step_pair_action),
        PHONE(R.string.light_step_phone_title, R.string.light_step_phone_body, R.string.light_step_phone_action),
        SMS(R.string.light_step_sms_title, R.string.light_step_sms_body, R.string.light_step_sms_action),
        FILTER(R.string.light_step_filter_title, R.string.light_step_filter_body, R.string.light_step_filter_action),
        USAGE(R.string.light_step_usage_title, R.string.light_step_usage_body, R.string.light_step_usage_action),
        ADMIN(R.string.light_step_admin_title, R.string.light_step_admin_body, R.string.light_step_admin_action),
        GUARD(R.string.light_step_guard_title, R.string.light_step_guard_body, R.string.light_step_guard_action),
        RUNNING(R.string.light_step_running_title, R.string.light_step_running_body, R.string.light_step_running_action, optional = true),
        LOCATION(R.string.light_step_location_title, R.string.light_step_location_body, R.string.light_step_location_action, optional = true),
        ALWAYS_ON(R.string.light_step_alwayson_title, R.string.light_step_alwayson_body, R.string.light_step_alwayson_action, optional = true),
    }

    fun isDone(context: Context, step: Step): Boolean = when (step) {
        Step.PIN -> !ConfigStore(context).load().usesDefaultPin
        Step.PHONE -> roleHeld(context, android.app.role.RoleManager.ROLE_DIALER)
        Step.SMS -> roleHeld(context, android.app.role.RoleManager.ROLE_SMS)
        Step.FILTER -> VpnService.prepare(context) == null
        Step.USAGE -> TimeGuard.hasUsageAccess(context)
        Step.ADMIN -> context.getSystemService(DevicePolicyManager::class.java)?.isAdminActive(LightAdminReceiver.component(context)) == true
        Step.RUNNING -> notificationsAllowed(context) &&
            context.getSystemService(android.os.PowerManager::class.java)?.isIgnoringBatteryOptimizations(context.packageName) == true
        Step.LOCATION -> context.checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED &&
            context.checkSelfPermission(Manifest.permission.ACCESS_BACKGROUND_LOCATION) == PackageManager.PERMISSION_GRANTED
        Step.GUARD -> Protections.isGuardEnabled(context)
        Step.ALWAYS_ON -> org.plainphone.app.light.vpn.PlainphoneVpnService.isAlwaysOn(context)
        Step.PAIR -> SyncStore(context).let { store ->
            if (hasDashboardPin(context) && !isComplete(context)) hasDashboardRules(store) else store.isPaired
        }
    }

    internal fun hasDashboardRules(store: SyncStore): Boolean =
        store.isPaired && store.etag != null && store.rules() != null

    fun profile(context: Context): String? = prefs(context).getString("profile", null)

    fun saveProfile(context: Context, profile: String) {
        prefs(context).edit().putString("profile", profile).apply()
    }

    fun clearProfile(context: Context) {
        prefs(context).edit().remove("profile").apply()
        SyncStore(context).savePairing(null)
    }

    fun linkReviewed(context: Context) = prefs(context).getBoolean("linkReviewed", false)

    @SuppressLint("ApplySharedPref") // Persist the review before exposing the enrollment token to sync.
    fun markLinkReviewed(context: Context) {
        prefs(context).edit().putBoolean("linkReviewed", true).commit()
    }

    fun hasDashboardPin(context: Context) = prefs(context).getBoolean("dashboardPin", false)

    @SuppressLint("ApplySharedPref") // Must survive going back to Chrome to renew an expired link.
    fun markDashboardPin(context: Context) {
        prefs(context).edit().putBoolean("dashboardPin", true).commit()
    }

    fun isSkipped(context: Context, step: Step) = step.optional && prefs(context).getBoolean("skip_${step.name}", false)

    fun skip(context: Context, step: Step) {
        prefs(context).edit().putBoolean("skip_${step.name}", true).apply()
    }

    fun skipOptions(context: Context) {
        val edit = prefs(context).edit()
        for (step in Step.entries) {
            if (step.optional) edit.putBoolean("skip_${step.name}", true)
        }
        edit.apply()
    }

    fun batteryMaker(): Int? = when (Build.MANUFACTURER.lowercase(java.util.Locale.ROOT)) {
        "oneplus" -> R.string.light_battery_oneplus
        "xiaomi", "redmi", "poco" -> R.string.light_battery_xiaomi
        "samsung" -> R.string.light_battery_samsung
        else -> null
    }

    fun batteryMakerSettings(context: Context): Intent = if (batteryMaker() == R.string.light_battery_samsung) {
        Intent("com.samsung.android.sm.ACTION_OPEN_CHECKABLE_LISTACTIVITY")
            .setPackage("com.samsung.android.lool")
            .putExtra("activity_type", 2) // Samsung's documented Never sleeping apps screen.
    } else {
        appDetails(context)
    }

    fun finishBatteryMakerHelp(context: Context) {
        prefs(context).edit().putBoolean("batteryMakerHelpSeen", true).apply()
    }

    /** The first step that still needs doing, or null when everything is set up. */
    fun next(context: Context): Step? = Step.entries.firstOrNull { step ->
        !isSkipped(context, step) && (!isDone(context, step) ||
            (step == Step.RUNNING && !isComplete(context) && batteryMaker() != null &&
                !prefs(context).getBoolean("batteryMakerHelpSeen", false)))
    }

    /** Setup counts as complete once it was finished once; afterwards the guard protects the screens. */
    fun isComplete(context: Context): Boolean = prefs(context).getBoolean("complete", false)

    @Synchronized
    @SuppressLint("ApplySharedPref") // A reboot must retain the completion marker.
    fun markComplete(context: Context) {
        if (isComplete(context)) return
        val edit = prefs(context).edit().putBoolean("complete", true)
        val sync = SyncStore(context)
        if (profile(context) != null && sync.isPaired && !sync.released && !sync.setupUndoPending) {
            val chosenMinutes = if (profile(context) == "self") prefs(context).getInt("setupUndoMinutes", 10) else 10
            val windowMs = (sync.setupUndoMinutes() ?: chosenMinutes) * 60_000L
            edit.putLong("completedElapsed", SystemClock.elapsedRealtime())
                .putBoolean("completionReported", false)
                .putLong("undoWindowMs", windowMs)
                .putInt("completedBoot", bootCount(context))
                .putString("completedPhoneId", sync.phoneId)
        }
        edit.commit()
        LightRelease.clear(context)
        if (sync.phoneId != null && pendingCompletion(context, sync.phoneId) != null) {
            SyncScheduler.now(context, "setup completed")
        }
    }

    internal fun pendingCompletion(context: Context, phoneId: String?): SetupCompletion? {
        val saved = prefs(context)
        val completedElapsed = saved.getLong("completedElapsed", -1)
        if (phoneId == null || phoneId != saved.getString("completedPhoneId", null) ||
            completedElapsed < 0 || saved.getBoolean("completionReported", false)
        ) return null

        val boot = bootCount(context)
        val elapsed = if (boot >= 0 && boot == saved.getInt("completedBoot", -1)) {
            (SystemClock.elapsedRealtime() - completedElapsed).takeIf { it >= 0 }
        } else {
            null
        }
        return SetupCompletion(elapsed, (saved.getLong("undoWindowMs", 0) / 60_000).toInt())
    }

    @SuppressLint("ApplySharedPref") // Only clear the durable report after the server acknowledges it.
    internal fun completionReported(context: Context) {
        prefs(context).edit().putBoolean("completionReported", true).commit()
    }

    internal fun clearAfterRelease(context: Context, undoPending: Boolean) {
        val saved = prefs(context)
        val edit = saved.edit()
        if (undoPending) {
            // Undo clears setup locally before sync can deliver the completion and undo reports.
            val completionKeys = setOf("completedPhoneId", "completedElapsed",
                "completedBoot", "undoWindowMs", "completionReported")
            for (key in saved.all.keys - completionKeys) edit.remove(key)
        } else {
            edit.clear()
        }
        edit.apply()
    }

    fun saveSelfKey(context: Context, waitHours: Int?, email: String, inviteByQr: Boolean) {
        prefs(context).edit().putInt("selfKeyHours", waitHours ?: 0)
            .putString("selfKeyEmail", email).putBoolean("selfKeyQr", inviteByQr).apply()
    }

    fun selfKey(context: Context): org.json.JSONObject? {
        if (profile(context) != "self") return null
        val saved = prefs(context)
        if (saved.getBoolean("selfKeyQr", false)) return org.json.JSONObject().put("keyType", "trustedQr")
        val hours = saved.getInt("selfKeyHours", 0)
        if (hours in listOf(1, 6, 12, 24, 48, 72)) {
            return org.json.JSONObject().put("keyType", "delay").put("delayHours", hours)
        }
        val email = saved.getString("selfKeyEmail", null)?.takeIf { it.isNotBlank() } ?: return null
        return org.json.JSONObject().put("keyType", "trusted").put("trustedEmail", email)
    }

    fun saveUndoMinutes(context: Context, minutes: Int) {
        require(minutes in SETUP_UNDO_CHOICES)
        prefs(context).edit().putInt("setupUndoMinutes", minutes).apply()
    }

    fun localUndoDeadline(context: Context): Long {
        val saved = prefs(context)
        val sync = SyncStore(context)
        if (!Mode.isLight(context) || !isComplete(context) || LightRelease.isReleased(context) ||
            !sync.isPaired || sync.phoneId != saved.getString("completedPhoneId", null) ||
            sync.released || sync.setupUndoPending
        ) return 0

        val boot = bootCount(context)
        if (boot < 0 || boot != saved.getInt("completedBoot", -1)) return 0
        val now = SystemClock.elapsedRealtime()
        val remaining = setupUndoRemaining(saved.getLong("completedElapsed", -1), now, saved.getLong("undoWindowMs", 0))
        return if (remaining > 0) now + remaining else 0
    }

    @Synchronized
    internal fun undo(context: Context): Boolean {
        val store = SyncStore(context)
        val phoneId = store.phoneId ?: return false
        if (localUndoDeadline(context) == 0L || !store.markSetupUndoPending(phoneId)) return false
        // Persist the accepted tap before switching off, so sync can finish the release after a crash.
        val app = context.applicationContext
        Lock.releaseAsync(app) { results ->
            if (results.all { it.ok }) {
                store.markReleased()
                SyncScheduler.finishSetupUndo(app)
            } else {
                SyncScheduler.recoverSetupUndoLocally(app)
            }
        }
        return true
    }

    private fun bootCount(context: Context) = Settings.Global.getInt(context.contentResolver, Settings.Global.BOOT_COUNT, -1)

    fun savePin(context: Context, pin: String, server: String? = null) {
        val salt = ByteArray(16).also { SecureRandom().nextBytes(it) }.joinToString("") { "%02x".format(it) }
        val store = ConfigStore(context)
        val config = store.load()
        store.save(config.copy(
            pinHashHex = MaintenancePin.hash(pin, salt),
            pinSaltHex = salt,
            serverUrl = server ?: config.serverUrl,
        ))
    }

    /** What the step's button opens. Null when the step is handled inside Plainphone (PIN, pairing). */
    fun intent(context: Context, step: Step): Intent? = when (step) {
        Step.PIN, Step.PAIR -> null
        Step.PHONE -> roleIntent(context, android.app.role.RoleManager.ROLE_DIALER)
        Step.SMS -> roleIntent(context, android.app.role.RoleManager.ROLE_SMS)
        Step.FILTER -> VpnService.prepare(context)
        Step.USAGE -> Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS, Uri.parse("package:${context.packageName}"))
        Step.ADMIN -> Intent(DevicePolicyManager.ACTION_ADD_DEVICE_ADMIN)
            .putExtra(DevicePolicyManager.EXTRA_DEVICE_ADMIN, LightAdminReceiver.component(context))
            .putExtra(DevicePolicyManager.EXTRA_ADD_EXPLANATION, context.getString(if (profile(context) == "self") R.string.setup_admin_self else R.string.light_admin_explanation))
        Step.RUNNING -> if (!notificationsAllowed(context)) {
            null // asked as a runtime permission by the activity
        } else {
            batteryExemptionRequest(context)
        }
        Step.LOCATION -> null // runtime permissions, asked by the activity
        Step.GUARD -> Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS)
        Step.ALWAYS_ON -> Intent(Settings.ACTION_VPN_SETTINGS)
    }

    fun appDetails(context: Context) =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:${context.packageName}"))

    fun notificationsAllowed(context: Context): Boolean =
        Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private fun roleHeld(context: Context, role: String) =
        context.getSystemService(android.app.role.RoleManager::class.java)?.isRoleHeld(role) == true

    private fun roleIntent(context: Context, role: String): Intent? =
        context.getSystemService(android.app.role.RoleManager::class.java)
            ?.takeIf { it.isRoleAvailable(role) }
            ?.createRequestRoleIntent(role)

    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
}
