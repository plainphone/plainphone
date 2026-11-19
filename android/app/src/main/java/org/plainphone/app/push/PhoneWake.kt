// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.push

import android.content.Context
import org.plainphone.app.sync.HttpError
import org.plainphone.app.sync.ServerRules
import org.plainphone.app.sync.SyncApi
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

internal data class WakeRegistration(val provider: String, val address: String? = null)

internal fun selectWakeProvider(
    preferred: String,
    unifiedPushAvailable: Boolean,
    fcmToken: () -> String?,
    endpoint: () -> String?,
    acceptFcm: (String) -> Boolean = { true },
): WakeRegistration {
    var validationError: HttpError? = null
    if (preferred == "fcm") {
        try {
            fcmToken()?.takeIf(acceptFcm)?.let { return WakeRegistration("fcm", it) }
        } catch (error: HttpError) {
            if (error.status != 503) throw error
            validationError = error
        }
    }
    if (preferred != "none" && unifiedPushAvailable) endpoint()?.let { return WakeRegistration("unifiedpush", it) }
    validationError?.let { throw it }
    return WakeRegistration("none")
}

internal fun wakeRegistrationPolicy(rules: ServerRules): String {
    val policy = "${rules.phoneId}:${rules.pushProvider}:${rules.unifiedPushAvailable}"
    return if (rules.pushProvider == "fcm") "$policy:fcm-v1:${rules.fcmValidationKey}" else policy
}

internal object PhoneWake {
    private const val RETRY_MS = 15 * 60 * 1000L
    const val REGISTRATION_CHANGED = "push registration"

    fun register(context: Context, api: SyncApi, token: String, force: Boolean): String {
        val store = SyncStore(context)
        val rules = store.rules()?.takeIf { it.phoneId == store.phoneId } ?: return "none"
        val cache = context.getSharedPreferences("wake-registration", Context.MODE_PRIVATE)
        val policy = wakeRegistrationPolicy(rules)
        if (!rules.unifiedPushAvailable) UnifiedWake.unregister(context)
        if (rules.pushProvider == "none") {
            if (cache.contains("policy")) cache.edit().clear().apply()
            return "none"
        }
        val now = System.currentTimeMillis()
        val samePolicy = cache.getString("policy", null) == policy
        val prior = cache.getString("provider", null)?.takeIf { samePolicy } ?: "none"
        if (!force && samePolicy && now - cache.getLong("checked", 0) in 0 until RETRY_MS) return prior

        val provider = runCatching {
            val selected = selectWakeProvider(rules.pushProvider, rules.unifiedPushAvailable,
                { FirebaseWake.token() }, { UnifiedWake.endpoint(context) },
                { api.registerWakeup(token, it, null) })
            if (selected.provider == "fcm" || api.registerWakeup(token, null, selected.address)) selected.provider else prior
        }.getOrDefault(prior)
        cache.edit().putString("policy", policy).putString("provider", provider).putLong("checked", now).apply()
        return provider
    }

    fun reason(value: String?) = value?.takeIf { it in setOf("rules", "locate", "update", "sos-ack") }

    fun receive(context: Context, provider: String, value: String?) {
        val reason = reason(value) ?: return
        val store = SyncStore(context)
        val rules = store.rules()?.takeIf { it.phoneId == store.phoneId } ?: return
        if (store.removed || store.releaseAsked || store.setupUndoPending) return
        val enabled = when (provider) {
            "fcm" -> rules.pushProvider == "fcm"
            "unifiedpush" -> rules.pushProvider != "none" && rules.unifiedPushAvailable
            else -> false
        }
        if (enabled) SyncScheduler.pushWake(context, reason)
    }
}
