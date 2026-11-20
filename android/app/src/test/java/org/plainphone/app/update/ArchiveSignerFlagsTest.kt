// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.update

import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.content.pm.Signature
import androidx.test.core.app.ApplicationProvider
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.shadows.ShadowApplicationPackageManager

/**
 * Android 10's archive parser fills `signatures` only when GET_SIGNATURES is requested (AOSP
 * PackageParser.collectCertificates). The shadow models that rule, so dropping the flag from
 * [AndroidUpdateHost.inspect] would leave the candidate APK without signers and refuse every update.
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [29], application = android.app.Application::class, shadows = [ArchiveSignerFlagsTest.Android10ArchiveShadow::class])
class ArchiveSignerFlagsTest {
    @Implements(className = "android.app.ApplicationPackageManager", isInAndroidSdk = false)
    class Android10ArchiveShadow : ShadowApplicationPackageManager() {
        @Suppress("DEPRECATION")
        @Implementation
        override fun getPackageArchiveInfo(archiveFilePath: String, flags: Int): PackageInfo =
            PackageInfo().apply {
                packageName = "org.plainphone.app"
                if (flags and PackageManager.GET_SIGNATURES != 0) signatures = arrayOf(Signature(byteArrayOf(1)))
            }
    }

    @Test fun inspectRequestsLegacySignaturesSoAndroid10ArchivesHaveSigners() {
        val context = ApplicationProvider.getApplicationContext<android.app.Application>()
        val info = AndroidUpdateHost(context).inspect(File("candidate.apk"))
        assertEquals(
            setOf("4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a"),
            info?.certSha256,
        )
    }
}
