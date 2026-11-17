// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.provisioning

import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.os.Bundle
import org.plainphone.app.Lock
import org.plainphone.app.PlainphoneAdminReceiver

/**
 * Android 12+ provisioning hands over to the DPC before setup finishes.
 * We set every policy here, so the phone is locked before the user ever
 * reaches the home screen, then return RESULT_OK.
 */
class PolicyComplianceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PlainphoneAdminReceiver.saveConfigFrom(this, intent)
        Lock.applyAsync(this, "provisioning (policy compliance)") {
            runOnUiThread { if (!askForDialerRole()) done() }
        }
    }

    /**
     * Android 12 and 13: Device Owner cannot set the phone app, so Android's role dialog is shown here,
     * while the parent is still in setup. Returns true if the dialog was opened.
     */
    private fun askForDialerRole(): Boolean {
        if (!Lock.applier(this).needsDialerDialog()) return false
        val roles = getSystemService(RoleManager::class.java) ?: return false
        if (!roles.isRoleAvailable(RoleManager.ROLE_DIALER)) return false
        return runCatching {
            @Suppress("DEPRECATION") // A plain Activity without the AndroidX result API.
            startActivityForResult(roles.createRequestRoleIntent(RoleManager.ROLE_DIALER), REQUEST_DIALER)
        }.isSuccess
    }

    @Deprecated("Plain Activity result callback.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode != REQUEST_DIALER) return
        // With the role held, the maker's phone apps can be hidden: apply once more before setup ends.
        Lock.applyAsync(this, "phone app dialog") { runOnUiThread { done() } }
    }

    private fun done() {
        setResult(RESULT_OK)
        finish()
    }

    private companion object {
        const val REQUEST_DIALER = 1
    }
}
