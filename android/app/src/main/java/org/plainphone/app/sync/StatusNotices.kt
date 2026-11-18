// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.annotation.SuppressLint
import android.content.Context
import java.util.UUID

/** Acknowledgements remove only the notice that the server accepted. */
internal class StatusNotices(context: Context) {
    private val prefs = context.getSharedPreferences("plainphone_state", Context.MODE_PRIVATE)

    @SuppressLint("ApplySharedPref")
    fun record(key: String) = synchronized(LOCK) {
        check(prefs.edit().putString(key, UUID.randomUUID().toString()).commit())
    }

    @SuppressLint("ApplySharedPref")
    fun pending(key: String): String? = synchronized(LOCK) {
        when (val value = prefs.all[key]) {
            is String -> value
            true -> UUID.randomUUID().toString().also { check(prefs.edit().putString(key, it).commit()) }
            else -> null
        }
    }

    @SuppressLint("ApplySharedPref")
    fun acknowledge(key: String, id: String) = synchronized(LOCK) {
        if (prefs.all[key] == id) check(prefs.edit().remove(key).commit())
    }

    companion object {
        const val PARALLEL_APPS_REMOVED = "parallel_apps_removed"
        const val LATE_GOOGLE_ACCOUNT = "late_google_account"
        private val LOCK = Any()
    }
}
