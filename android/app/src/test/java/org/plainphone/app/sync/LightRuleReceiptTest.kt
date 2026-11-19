// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.sync

import android.app.AppOpsManager
import android.app.admin.DevicePolicyManager
import android.app.role.RoleManager
import android.content.ComponentName
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.os.Process
import android.provider.Settings
import androidx.test.core.app.ApplicationProvider
import com.google.common.truth.Truth.assertThat
import java.io.RandomAccessFile
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import org.junit.runner.RunWith
import org.plainphone.app.Lock
import org.plainphone.app.light.GuardService
import org.plainphone.app.light.LightAdminReceiver
import org.plainphone.app.light.vpn.PlainphoneVpnService
import org.robolectric.Robolectric
import org.robolectric.RobolectricTestRunner
import org.robolectric.Shadows.shadowOf
import org.robolectric.annotation.Config
import org.robolectric.annotation.Implementation
import org.robolectric.annotation.Implements
import org.robolectric.annotation.RealObject
import org.robolectric.shadows.ShadowRoleManager
import org.robolectric.shadows.ShadowVpnService

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], shadows = [LightRuleReceiptTest.TunnelBuilder::class])
class LightRuleReceiptTest {
    private val context = ApplicationProvider.getApplicationContext<android.app.Application>()

    @get:Rule val files = TemporaryFolder()

    @Test
    fun `sync only acknowledges the rules once the VPN is using their resolver`() {
        val dpm = context.getSystemService(DevicePolicyManager::class.java)
        shadowOf(dpm).setActiveAdmin(LightAdminReceiver.component(context))
        ShadowRoleManager.addRoleHolder(RoleManager.ROLE_DIALER, context.packageName, Process.myUserHandle())
        ShadowRoleManager.addRoleHolder(RoleManager.ROLE_SMS, context.packageName, Process.myUserHandle())
        shadowOf(context.getSystemService(AppOpsManager::class.java)).setMode(
            AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), context.packageName, AppOpsManager.MODE_IGNORED,
        )
        Settings.Secure.putString(
            context.contentResolver, Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ComponentName(context, GuardService::class.java).flattenToString(),
        )
        ShadowVpnService.setPrepareResult(null)
        val api = FakeSyncApi()
        val store = SyncStore(context, FakeSecretBox())
        store.savePaired("7f1c2b9e-0000-4000-8000-000000000001", "pp_d_token")
        val runner = SyncRunner(store, api, object : SyncDevice by FakeSyncDevice() {
            override fun applyLockIfNeeded(reason: String, maxAgeMs: Long) {
                Lock.applyIfNeeded(context, reason, maxAgeMs)
            }

            override fun lockState() = Lock.lockState(context)
        })

        val service = Robolectric.buildService(PlainphoneVpnService::class.java).create()
        try {
            api.rules = RulesResult.Changed("\"first\"", rulesJson())
            runner.run("VPN start requested")
            val start = shadowOf(context).nextStartedService
            assertThat(start.component?.className).isEqualTo(PlainphoneVpnService::class.java.name)
            assertThat(api.statuses.last().rulesEtag).isNull()
            assertThat(api.statuses.last().protections).containsEntry("usageAccessGranted", false)
            assertThat(api.statuses.last().protections).containsEntry("usageAccess", true)

            // Android accepts startService even if the tunnel cannot subsequently be established.
            assertThat(service.get().onStartCommand(start, 0, 1)).isEqualTo(VpnService.START_NOT_STICKY)
            api.rules = RulesResult.Unchanged
            runner.run("VPN failed")
            assertThat(api.statuses.last().rulesEtag).isNull()

            // Robolectric's createPipe uses a regular file, where the VPN reader immediately hits EOF.
            val fifo = files.root.resolve("vpn")
            assertThat(ProcessBuilder("mkfifo", fifo.path).start().waitFor()).isEqualTo(0)
            RandomAccessFile(fifo, "rw").use {
                TunnelBuilder.descriptor = ParcelFileDescriptor.open(fifo, ParcelFileDescriptor.MODE_READ_ONLY)
                assertThat(service.get().onStartCommand(start, 0, 2)).isEqualTo(VpnService.START_STICKY)
                runner.run("VPN active")
                assertThat(api.statuses.last().rulesEtag).isEqualTo("\"first\"")
                assertThat(api.statuses.last().rulesAppliedAtMs).isNotNull()

                val newHost = "new.dns.example.org"
                api.rules = RulesResult.Changed("\"second\"", rulesJson().replace("abcdefghijklmnopqrst.dns.plainphone.org", newHost))
                runner.run("resolver switch requested")
                assertThat(api.statuses.last().rulesEtag).isNull()
                val switch = shadowOf(context).nextStartedService
                assertThat(switch.getStringExtra(PlainphoneVpnService.EXTRA_HOST)).isEqualTo(newHost)
                assertThat(service.get().onStartCommand(switch, 0, 3)).isEqualTo(VpnService.START_STICKY)
                api.rules = RulesResult.Unchanged
                runner.run("resolver switched")
                assertThat(api.statuses.last().rulesEtag).isEqualTo("\"second\"")
            }
        } finally {
            service.destroy()
            TunnelBuilder.descriptor = null
        }
    }

    @Implements(VpnService.Builder::class)
    class TunnelBuilder {
        @RealObject private lateinit var builder: VpnService.Builder

        @Implementation
        fun addAddress(address: String, prefixLength: Int): VpnService.Builder = builder

        @Implementation
        fun addDnsServer(address: String): VpnService.Builder = builder

        @Implementation
        fun addDisallowedApplication(packageName: String): VpnService.Builder = builder

        @Implementation
        fun establish(): ParcelFileDescriptor? = descriptor

        companion object {
            var descriptor: ParcelFileDescriptor? = null
        }
    }
}
