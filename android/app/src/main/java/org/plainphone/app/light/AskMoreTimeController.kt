// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import android.util.Log
import java.io.IOException
import java.time.Instant
import java.time.ZoneId
import org.plainphone.app.ConfigStore
import org.plainphone.app.home.HomeActivity
import org.plainphone.app.sync.PlainphoneApi
import org.plainphone.app.sync.SyncScheduler
import org.plainphone.app.sync.SyncStore
import org.plainphone.app.time.MoreTime
import org.plainphone.app.time.MoreTimeOutbox
import org.plainphone.app.time.TimeGuard

/**
 * The stop screen's side of asking for more time for [pkg]. Blocking: call off the main thread.
 * The ask is saved before anything is sent, so going offline never loses it; the sync loop sends
 * what this could not.
 */
internal class AskMoreTimeController(context: Context, private val pkg: String) {
    private val app = context.applicationContext
    private val store = SyncStore(app)

    /** The current state, after sending saved asks and fetching answers. Null: no ask on this screen. */
    fun state(online: Boolean = true): MoreTime.Ui? {
        val rules = store.rules() ?: return null
        if (!rules.askMoreTimeEnabled || rules.profile != "child") return null
        val snap = TimeGuard.snapshot(app) ?: return null
        val now = Instant.now()
        val today = now.atZone(rules.timezone).toLocalDate()
        if (online) exchange(today)
        val target = MoreTime.target(snap.evaluation, pkg) { store.moreTime.latest(it, today) } ?: return null
        return MoreTime.ui(
            store.moreTime.latest(target, today), today, now.toEpochMilli(),
            snap.limits.capMinutes(target, today), snap.evaluation.remainingFor(pkg),
        ) { ms -> HomeActivity.timeText(app, Instant.ofEpochMilli(ms).atZone(ZoneId.systemDefault()).toLocalTime()) }
    }

    /** Saves the ask for whatever is used up, tries to send it at once, and returns the new state. */
    fun ask(reason: String): MoreTime.Ui? {
        val rules = store.rules() ?: return null
        val snap = TimeGuard.snapshot(app) ?: return null
        val today = Instant.now().atZone(rules.timezone).toLocalDate()
        val target = MoreTime.target(snap.evaluation, pkg) { null } ?: return state(online = false)
        store.moreTime.ask(target, today, reason, System.currentTimeMillis(), snap.limits.capMinutes(target, today))
        if (!exchange(today)) runCatching { SyncScheduler.now(app, "ask for more time") }
        return state(online = false)
    }

    /** Sends saved asks and fetches answers. False when the server could not be reached. */
    private fun exchange(today: java.time.LocalDate): Boolean {
        val token = store.deviceToken() ?: return false
        val api = PlainphoneApi(ConfigStore(app).load().serverUrl, app)
        return try {
            MoreTimeOutbox.send(store.moreTime, api, token, today)
            MoreTimeOutbox.refresh(store.moreTime, api, token, today)
            true
        } catch (e: IOException) {
            Log.i(TAG, "ask for more time: offline (${e.message})")
            false
        }
    }

    private companion object {
        const val TAG = "Plainphone"
    }
}
