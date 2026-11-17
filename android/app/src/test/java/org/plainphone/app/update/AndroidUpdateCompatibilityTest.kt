// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.pm.PackageInfo
import android.content.pm.Signature
import android.os.PowerManager
import androidx.test.core.app.ApplicationProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], application = android.app.Application::class)
class AndroidUpdateCompatibilityTest {
    @Suppress("DEPRECATION")
    @Test fun android10ArchiveUsesLegacySignersWhenSigningInfoIsMissing() {
        val info = PackageInfo().apply {
            packageName = "org.plainphone.app"
            signatures = arrayOf(Signature(byteArrayOf(1)), Signature(byteArrayOf(2)))
        }
        assertEquals(
            setOf(
                "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
                "dbc1b4c900ffe48d575b5da5c638040125f65db0fe3e24494b76ea986457d986",
            ),
            AndroidUpdateHost.apkInfo(info).certSha256,
        )
        assertTrue(AndroidUpdateHost.apkInfo(info, sdk = 30).certSha256.isEmpty())
    }

    @Suppress("DEPRECATION")
    @Test fun screenOffPreventsPollingEvenWhenWorkWasAlreadyQueued() {
        val power = ApplicationProvider.getApplicationContext<android.app.Application>()
            .getSystemService(PowerManager::class.java)!!
        val tasks = ArrayDeque<Runnable>()
        var polls = 0
        val listener = InteractiveUpdatePoll({ power.isInteractive }, { tasks.addLast(it) }) {
            polls++
        }
        shadowOf(power).setIsInteractive(true)
        listener.wake()
        shadowOf(power).setIsInteractive(false)
        listener.sleep()
        tasks.removeFirst().run()
        listener.wake()
        assertTrue(tasks.isEmpty())
        assertEquals(0, polls)
        shadowOf(power).setIsInteractive(true)
        listener.wake()
        tasks.removeFirst().run()
        assertEquals(1, polls)
    }

    @Test fun conflictIsRetried() {
        assertTrue(UpdateRequestListener.shouldRetryHttpStatus(409))
    }
}
