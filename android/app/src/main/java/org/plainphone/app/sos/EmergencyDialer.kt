// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.sos

import android.content.Context
import android.content.Intent
import android.net.Uri

internal fun openEmergencyDialer(context: Context) {
    val system = Intent("com.android.phone.EmergencyDialer.DIAL").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    if (runCatching { context.startActivity(system) }.isSuccess) return
    runCatching { context.startActivity(emergencyKeypadIntent()) }
}

internal fun emergencyKeypadIntent() =
    Intent(Intent.ACTION_DIAL, Uri.parse("tel:112")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
