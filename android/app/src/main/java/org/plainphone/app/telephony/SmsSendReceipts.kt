// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.telephony

import android.content.Context

/** Pending part numbers survive process death between modem callbacks. */
internal class SmsSendReceipts(context: Context) {
    private val prefs = context.getSharedPreferences("plainphone_sms_receipts", Context.MODE_PRIVATE)

    fun start(id: String, count: Int): Boolean = synchronized(lock) {
        if (count <= 0) return@synchronized false
        prefs.edit().putStringSet(id, (0 until count).map(Int::toString).toSet()).commit()
    }

    fun cancel(id: String) = synchronized(lock) {
        prefs.edit().remove(id).apply()
    }

    /** Returns a final status once, or null while awaiting callbacks. */
    fun receive(id: String, part: Int, success: Boolean): Boolean? = synchronized(lock) {
        val pending = prefs.getStringSet(id, null) ?: return@synchronized null
        if (part.toString() !in pending) return@synchronized null
        val remaining = pending - part.toString()
        if (success && remaining.isNotEmpty()) {
            prefs.edit().putStringSet(id, remaining).apply()
            null
        } else {
            prefs.edit().remove(id).apply()
            success
        }
    }

    private companion object {
        val lock = Any()
    }
}
