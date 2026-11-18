// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.provisioning

import android.app.Activity
import android.os.Bundle
import org.plainphone.app.PlainphoneAdminReceiver

/** Android grants Device Owner during provisioning. Plainphone applies policies after phone setup. */
class PolicyComplianceActivity : Activity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        PlainphoneAdminReceiver.saveConfigFrom(this, intent)
        setResult(RESULT_OK)
        finish()
    }
}
