// SPDX-License-Identifier: Apache-2.0
package org.plainphone.app.push

import com.google.android.gms.tasks.Tasks
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.util.concurrent.TimeUnit
import org.plainphone.app.sync.SyncScheduler

internal object FirebaseWake {
    fun token(): String? = runCatching {
        Tasks.await(FirebaseMessaging.getInstance().token, 3, TimeUnit.SECONDS)
    }.getOrNull()
}

class FirebaseWakeService : FirebaseMessagingService() {
    override fun onMessageReceived(message: RemoteMessage) {
        if (message.notification == null) PhoneWake.receive(this, "fcm", message.data["wake"])
    }

    override fun onNewToken(token: String) {
        SyncScheduler.pushRegistrationChanged(this)
    }
}
