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
import org.plainphone.app.ConfigStore
import org.plainphone.app.MaintenancePin
import org.plainphone.app.R
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.sync.PlainphoneApi
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
            edit.putLong("completedElapsed", SystemClock.elapsedRealtime())
                .putLong("completedAtMs", System.currentTimeMillis())
                .putInt("completedBoot", bootCount(context))
                .putString("completedPhoneId", sync.phoneId)
        }
        edit.commit()
        LightRelease.clear(context)
    }

    private fun canUndo(context: Context): Boolean {
        val sync = SyncStore(context)
        return Mode.isLight(context) && isComplete(context) && prefs(context).contains("completedElapsed") &&
            sync.isPaired && sync.phoneId == prefs(context).getString("completedPhoneId", null) &&
            !sync.released && !sync.setupUndoPending
    }

    fun localUndoDeadline(context: Context): Long {
        if (!canUndo(context)) return 0
        val saved = prefs(context)
        val now = SystemClock.elapsedRealtime()
        val remaining = completionElapsed(context, now)?.let { (SETUP_UNDO_MS - it).coerceAtLeast(0) }
            ?: setupUndoRemaining(saved.getLong("completedAtMs", -1), System.currentTimeMillis())
        return if (remaining > 0) now + remaining else 0
    }

    /** Retry an unacknowledged completion when setup or Home opens, including after a reboot. */
    fun undoDeadline(context: Context): Long {
        if (!canUndo(context)) return 0
        val token = SyncStore(context).deviceToken() ?: return 0
        val now = SystemClock.elapsedRealtime()
        if (completionElapsed(context, now)?.let { it >= SETUP_UNDO_MS } == true) return 0
        val api = PlainphoneApi(ConfigStore(context).load().serverUrl, context.applicationContext)
        val remaining = registerCompletion(context, api, token, now)
            .coerceIn(0, completionElapsed(context, now)?.let { (SETUP_UNDO_MS - it).coerceAtLeast(0) } ?: SETUP_UNDO_MS)
        return if (remaining > 0) now + remaining else 0
    }

    private fun completionElapsed(context: Context, now: Long): Long? {
        val saved = prefs(context)
        val boot = bootCount(context)
        val completed = saved.getLong("completedElapsed", -1)
        return if (boot >= 0 && boot == saved.getInt("completedBoot", -1) && completed in 0..now) {
            now - completed
        } else null
    }

    private fun registerCompletion(context: Context, api: PlainphoneApi, token: String, now: Long): Long {
        val saved = prefs(context)
        if (saved.getBoolean("completionRegistered", false)) return api.setupUndoRemaining(token, null)
        val completedAt = saved.getLong("completedAtMs", -1).takeIf { it > 0 }
        val elapsed = completionElapsed(context, now)
            ?: completedAt?.let { (System.currentTimeMillis() - it).takeIf { age -> age >= 0 } }
        if (elapsed != null && elapsed > SETUP_UNDO_MS + SETUP_UNDO_RETRY_MS) return 0
        val remaining = api.setupUndoRemaining(token, elapsed, completedAt)
        if (remaining > 0) saved.edit().putBoolean("completionRegistered", true).apply()
        return remaining
    }

    data class UndoTap(val elapsed: Long, val remaining: Long, val boot: Int)

    fun undoTap(context: Context): UndoTap? {
        if (!canUndo(context)) return null
        val saved = prefs(context)
        val tappedAt = saved.getLong("undoTapElapsed", -1)
        val remaining = saved.getLong("undoTapRemaining", 0)
        if (tappedAt < 0 || remaining !in 1..SETUP_UNDO_MS) return null
        return UndoTap(tappedAt, remaining, saved.getInt("undoTapBoot", -1))
    }

    @SuppressLint("ApplySharedPref") // Keep the original tap if the response is lost or the screen is recreated.
    fun recordUndoTap(context: Context, deadline: Long): UndoTap? {
        undoTap(context)?.let { return it }
        val tappedAt = SystemClock.elapsedRealtime()
        val remaining = deadline - tappedAt
        if (!canUndo(context) || remaining !in 1..SETUP_UNDO_MS) return null
        val boot = bootCount(context)
        prefs(context).edit()
            .putLong("undoTapElapsed", tappedAt)
            .putLong("undoTapRemaining", remaining)
            .putInt("undoTapBoot", boot)
            .commit()
        return UndoTap(tappedAt, remaining, boot)
    }

    fun clearUndoTap(context: Context) {
        prefs(context).edit().remove("undoTapElapsed").remove("undoTapRemaining").remove("undoTapBoot").apply()
    }

    fun requestUndo(context: Context, tap: UndoTap): Boolean {
        if (!canUndo(context)) return false
        val store = SyncStore(context)
        val token = store.deviceToken() ?: return false
        val api = PlainphoneApi(ConfigStore(context).load().serverUrl, context.applicationContext)
        if (tapAge(context, tap) != null && !prefs(context).getBoolean("completionRegistered", false)) {
            registerCompletion(context, api, token, SystemClock.elapsedRealtime())
        }
        val age = tapAge(context, tap)
        val authorized = if (age == null) api.recoverSetupUndo(token)
            else api.authorizeSetupUndo(token, age, tap.remaining)
        if (!authorized) return false
        if (!store.saveSetupUndoAccepted(token)) throw java.io.IOException("could not save setup undo authorization")
        return true
    }

    private fun tapAge(context: Context, tap: UndoTap): Long? =
        if (tap.boot >= 0 && tap.boot == bootCount(context)) setupUndoTapAge(tap.elapsed, SystemClock.elapsedRealtime())
        else null

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
    @SuppressLint("BatteryLife") // Plainphone must keep running to filter calls and enforce the parent's rules.
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
            Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:${context.packageName}"))
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
