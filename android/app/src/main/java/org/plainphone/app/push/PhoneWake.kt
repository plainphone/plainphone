// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.push

import android.content.Context
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore

internal data class WakeRegistration(val provider: String, val address: String? = null)

internal fun selectWakeProvider(
    preferred: String,
    unifiedPushAvailable: Boolean,
    fcmToken: () -> String?,
    endpoint: () -> String?,
): WakeRegistration {
    if (preferred == "fcm") fcmToken()?.let { return WakeRegistration("fcm", it) }
    if (preferred != "none" && unifiedPushAvailable) endpoint()?.let { return WakeRegistration("unifiedpush", it) }
    return WakeRegistration("none")
}

internal object PhoneWake {
    fun registration(context: Context): WakeRegistration {
        val store = SyncStore(context)
        val rules = store.rules()?.takeIf { it.phoneId == store.phoneId } ?: return WakeRegistration("none")
        val selected = selectWakeProvider(rules.pushProvider, rules.unifiedPushAvailable,
            { FirebaseWake.token() }, { UnifiedWake.endpoint(context) })
        if (selected.provider == "fcm" || !rules.unifiedPushAvailable) UnifiedWake.unregister(context)
        return selected
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
        if (enabled) SyncScheduler.now(context, "push: $reason")
    }
}
