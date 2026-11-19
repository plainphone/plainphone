// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.quiet

import android.app.NotificationManager
import android.content.Context
import android.content.SharedPreferences

/** The part of Do Not Disturb that Plainphone changes: the filter, and which categories break through. */
data class ZenPolicy(
    val categories: Int,
    val callSenders: Int,
    val messageSenders: Int,
    val visualEffects: Int,
)

/** Android's Do Not Disturb, kept behind an interface so the logic is tested on the JVM. */
interface ZenControls {
    val hasAccess: Boolean
    var filter: Int
    var policy: ZenPolicy
}

/** What [BedtimeDnd.apply] did. */
enum class DndOutcome {
    /** Do Not Disturb is on for bedtime. */
    ACTIVE,
    /** Bedtime is over (or silent bedtime is off): the phone's own Do Not Disturb setting is back. */
    RESTORED,
    /** Nothing to do. */
    IDLE,
    /**
     * Android has not given Plainphone access to Do Not Disturb, so only Plainphone's own calls and
     * messages are silent. Other apps keep their sounds. Android lets only the user grant this.
     */
    NO_ACCESS,
}

/** Remembers the phone's own Do Not Disturb setting while bedtime has changed it. */
interface DndStore {
    var active: Boolean
    var previousFilter: Int
    var previousPolicy: ZenPolicy?
}

/**
 * Turns on Android's Do Not Disturb for bedtime and puts the phone's own setting back afterwards.
 *
 * Only alarms and calls break through (calls are then sorted by Plainphone's call screening, so only
 * parents, help lines and an emergency call-back ring). Android calls an emergency number a
 * call too and never silences outgoing emergency calls. If the child or a parent changes Do Not
 * Disturb during bedtime, Plainphone does not fight it and does not touch it afterwards either.
 */
class BedtimeDnd(private val zen: ZenControls, private val store: DndStore) {

    fun apply(silent: Boolean): DndOutcome {
        if (!zen.hasAccess) {
            // Access taken away while bedtime was on: nothing can be restored, forget it.
            if (store.active) store.active = false
            return if (silent) DndOutcome.NO_ACCESS else DndOutcome.IDLE
        }
        return if (silent) start() else stop()
    }

    private fun start(): DndOutcome {
        if (store.active) return DndOutcome.ACTIVE
        store.previousFilter = zen.filter
        store.previousPolicy = zen.policy
        // The policy first: the filter then takes it into account at once.
        zen.policy = BEDTIME_POLICY
        zen.filter = NotificationManager.INTERRUPTION_FILTER_PRIORITY
        store.active = true
        return DndOutcome.ACTIVE
    }

    private fun stop(): DndOutcome {
        if (!store.active) return DndOutcome.IDLE
        store.active = false
        // Someone switched it off or changed the mode during bedtime: that was their choice, not ours to undo.
        // Only the mode is compared: some phones adjust the categories a little when they are saved.
        if (zen.filter != NotificationManager.INTERRUPTION_FILTER_PRIORITY) return DndOutcome.IDLE
        store.previousPolicy?.let { zen.policy = it }
        zen.filter = store.previousFilter
        return DndOutcome.RESTORED
    }

    companion object {
        /** Alarms and calls may break through; messages, reminders, events and media may not. */
        val BEDTIME_POLICY = ZenPolicy(
            categories = NotificationManager.Policy.PRIORITY_CATEGORY_CALLS or NotificationManager.Policy.PRIORITY_CATEGORY_ALARMS,
            callSenders = NotificationManager.Policy.PRIORITY_SENDERS_ANY,
            messageSenders = NotificationManager.Policy.PRIORITY_SENDERS_ANY,
            visualEffects = 0,
        )

        fun forContext(context: Context): BedtimeDnd {
            val app = context.applicationContext
            val nm = app.getSystemService(NotificationManager::class.java)
            val prefs = app.getSharedPreferences("plainphone_bedtime", Context.MODE_PRIVATE)
            return BedtimeDnd(AndroidZen(nm), PrefsDndStore(prefs))
        }

        /** Whether Android has given Plainphone access to Do Not Disturb. */
        fun hasAccess(context: Context): Boolean =
            context.getSystemService(NotificationManager::class.java)?.isNotificationPolicyAccessGranted == true
    }
}

private class AndroidZen(private val nm: NotificationManager) : ZenControls {
    override val hasAccess: Boolean get() = nm.isNotificationPolicyAccessGranted

    override var filter: Int
        get() = nm.currentInterruptionFilter
        set(value) = nm.setInterruptionFilter(value)

    override var policy: ZenPolicy
        get() = nm.notificationPolicy.let { ZenPolicy(it.priorityCategories, it.priorityCallSenders, it.priorityMessageSenders, it.suppressedVisualEffects) }
        set(value) = nm.setNotificationPolicy(
            NotificationManager.Policy(value.categories, value.callSenders, value.messageSenders, value.visualEffects),
        )
}

private class PrefsDndStore(private val prefs: SharedPreferences) : DndStore {
    override var active: Boolean
        get() = prefs.getBoolean("dnd_active", false)
        set(value) = prefs.edit().putBoolean("dnd_active", value).apply()

    override var previousFilter: Int
        get() = prefs.getInt("dnd_previous_filter", NotificationManager.INTERRUPTION_FILTER_ALL)
        set(value) = prefs.edit().putInt("dnd_previous_filter", value).apply()

    override var previousPolicy: ZenPolicy?
        get() = if (!prefs.contains("dnd_previous_categories")) null else ZenPolicy(
            prefs.getInt("dnd_previous_categories", 0),
            prefs.getInt("dnd_previous_call_senders", 0),
            prefs.getInt("dnd_previous_message_senders", 0),
            prefs.getInt("dnd_previous_effects", 0),
        )
        set(value) {
            val edit = prefs.edit()
            if (value == null) {
                edit.remove("dnd_previous_categories")
            } else {
                edit.putInt("dnd_previous_categories", value.categories)
                    .putInt("dnd_previous_call_senders", value.callSenders)
                    .putInt("dnd_previous_message_senders", value.messageSenders)
                    .putInt("dnd_previous_effects", value.visualEffects)
            }
            edit.apply()
        }
}
