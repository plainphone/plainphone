// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.provisioning

import android.app.Activity
import android.app.AlertDialog
import android.content.SharedPreferences
import org.plainphone.app.R
import org.plainphone.app.light.Mode
import org.plainphone.app.sync.SyncStore

/** Shows the connected account once, including when background enrollment finishes after launch. */
internal class EnrollmentAccountNotice(private val activity: Activity) {
    private val store = SyncStore(activity)
    private val listener = SharedPreferences.OnSharedPreferenceChangeListener { _, _ -> showIfReady() }
    private var dialog: AlertDialog? = null

    fun start() {
        if (!Mode.isStrong(activity)) return
        store.watchEnrollmentAccount(listener)
        showIfReady()
    }

    fun stop() {
        store.unwatchEnrollmentAccount(listener)
        dialog?.dismiss()
        dialog = null
    }

    private fun showIfReady() {
        if (activity.isFinishing || dialog?.isShowing == true) return
        val account = store.enrollmentAccount() ?: return
        val title = if (account.householdName.isNullOrBlank()) {
            activity.getString(R.string.setup_connected_account, account.maskedEmail)
        } else {
            activity.getString(R.string.setup_connected_household, account.maskedEmail, account.householdName)
        }
        dialog = AlertDialog.Builder(activity)
            .setTitle(title)
            .setMessage(R.string.setup_connected_release)
            .setPositiveButton(android.R.string.ok) { _, _ -> store.dismissEnrollmentAccount() }
            .setOnCancelListener { store.dismissEnrollmentAccount() }
            .show()
    }
}
