// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.provisioning

import android.app.Activity
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
            runOnUiThread {
                setResult(RESULT_OK)
                finish()
            }
        }
    }
}
