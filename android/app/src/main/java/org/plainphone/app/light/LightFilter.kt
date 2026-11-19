// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light

import android.content.Context
import android.net.ConnectivityManager
import android.net.DnsResolver
import android.os.CancellationSignal
import android.provider.Settings
import org.plainphone.app.light.vpn.PlainphoneVpnService
import org.plainphone.app.sync.SyncStore
import java.net.InetAddress
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

enum class FilterMethod(val wire: String) {
    VPN("vpn"),
    PRIVATE_DNS("privateDns");

    companion object {
        fun fromWire(value: String?) = entries.firstOrNull { it.wire == value } ?: VPN
    }
}

data class FilterHealth(val method: FilterMethod, val working: Boolean, val issue: String? = null)

object LightFilter {
    fun method(context: Context): FilterMethod = SyncStore(context).rules()?.filterMethod ?: FilterMethod.VPN

    fun host(context: Context): String? = SyncStore(context).rules()?.takeIf { it.privateDnsReady }?.dnsHost

    fun shouldStopVpn(method: FilterMethod, alwaysOn: Boolean, lockdown: Boolean): Boolean =
        method == FilterMethod.PRIVATE_DNS && !alwaysOn && !lockdown

    fun vpnHandoffBlocked(context: Context): Boolean =
        PlainphoneVpnService.isAlwaysOn(context) || PlainphoneVpnService.isLockdownEnabled(context)

    fun strictDnsConfigured(context: Context): Boolean =
        !vpnPrivateDnsOk(Settings.Global.getString(context.contentResolver, "private_dns_mode"), null)

    fun vpnPrivateDnsOk(mode: String?, activeHostname: String?): Boolean =
        mode != "hostname" && activeHostname.isNullOrBlank()

    fun privateDnsSetupIssue(context: Context): String? =
        if (vpnHandoffBlocked(context)) "alwaysOn" else setupIssue(context)

    fun setupIssue(context: Context, expected: String? = host(context)): String? = issue(
        Settings.Global.getString(context.contentResolver, "private_dns_mode"),
        Settings.Global.getString(context.contentResolver, "private_dns_specifier"),
        expected,
    )

    fun issue(mode: String?, actual: String?, expected: String?): String? = when {
        expected == null -> "waiting"
        mode == "off" -> "off"
        mode != "hostname" -> "automatic"
        !expected.equals(actual, ignoreCase = true) -> "wrongHost"
        else -> null
    }

    fun canaryMatches(rcode: Int, addresses: List<String>) =
        rcode == 0 && addresses == listOf("192.0.2.42")

    /** Called by the sync worker. Use Android's active system DNS path and a fresh name each time. */
    @Suppress("DEPRECATION") // getInstance is available throughout the supported Android versions.
    fun probe(context: Context, protections: Map<String, Boolean>?): FilterHealth {
        val method = method(context)
        if (method == FilterMethod.VPN) {
            val strict = strictDnsConfigured(context) || protections?.get("privateDnsOk") == false
            val working = protections?.get("vpn") == true && protections["privateDnsOk"] == true && !strict
            return FilterHealth(method, working, if (strict) "strictDns" else null)
        }
        privateDnsSetupIssue(context)?.let { return FilterHealth(method, false, it) }
        val cm = context.getSystemService(ConnectivityManager::class.java)
        val network = cm.activeNetwork
        val expectedHost = host(context)
        fun validated(): Boolean {
            if (network == null || cm.activeNetwork != network || privateDnsSetupIssue(context) != null) return false
            val properties = cm.getLinkProperties(network)
            return properties?.isPrivateDnsActive == true &&
                expectedHost != null && expectedHost.equals(properties.privateDnsServerName, ignoreCase = true)
        }
        val working = validated() && runCatching {
            val complete = CountDownLatch(1)
            val cancel = CancellationSignal()
            var matched = false
            try {
                DnsResolver.getInstance().query(
                    network, "${UUID.randomUUID()}.plainphone-filter.test.", DnsResolver.TYPE_A,
                    DnsResolver.FLAG_EMPTY,
                    { it.run() }, cancel, object : DnsResolver.Callback<List<InetAddress>> {
                        override fun onAnswer(answer: List<InetAddress>, rcode: Int) {
                            matched = canaryMatches(rcode, answer.mapNotNull { it.hostAddress })
                            complete.countDown()
                        }

                        override fun onError(error: DnsResolver.DnsException) {
                            complete.countDown()
                        }
                    },
                )
                complete.await(3, TimeUnit.SECONDS) && matched && validated()
            } finally {
                cancel.cancel()
            }
        }.getOrDefault(false)
        return FilterHealth(method, working, if (working) null else privateDnsSetupIssue(context) ?: "unverified")
    }
}
