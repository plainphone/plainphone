// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.net.VpnService
import android.os.ParcelFileDescriptor
import android.util.Log
import java.io.FileInputStream
import java.io.FileOutputStream
import java.io.IOException
import java.lang.ref.WeakReference
import org.plainphone.app.light.LightRelease

/** What the VPN tells the rest of the app about itself. */
enum class VpnEvent { Started, Stopped }

/** One hook for status reporting: set [listener] once (for example in Application.onCreate). Called on whatever thread the event happens on. */
object VpnEvents {
    @Volatile
    var listener: ((VpnEvent) -> Unit)? = null

    internal fun emit(event: VpnEvent) {
        try {
            listener?.invoke(event)
        } catch (e: RuntimeException) {
            Log.w("PlainphoneVpn", "VPN event listener failed")
        }
    }
}

/**
 * The DNS-only VPN of light mode (docs/light-mode-vpn.md).
 *
 * The tunnel carries only DNS: the two fake DNS servers it announces and the addresses of well-known public
 * resolvers ([ResolverBlocklist]). DNS queries to those are answered by the Plainphone resolver over
 * DNS-over-TLS, anything else sent to a public resolver is dropped, and all other traffic never enters
 * the VPN. Plainphone itself is kept out of the VPN, so its own lookups and its DNS-over-TLS connection
 * go straight to the network.
 *
 * Start it with [start]; the system restarts it with a null intent (always-on VPN, or after a kill), and
 * it then reuses the host from the last start. Not a foreground service: a VPN does not need one.
 * Never logs a DNS name or an address.
 */
class PlainphoneVpnService : VpnService() {
    @Volatile private var tunnel: Tunnel? = null

    /** Set when [stop] asked for the stop, so [onDestroy] does not count it as a revocation. */
    @Volatile private var stoppedByApp = false
    private var stoppedReported = false

    override fun onCreate() {
        super.onCreate()
        instanceRef = WeakReference(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        // Android can restart an always-on VPN even after the app stopped it during release.
        val host = if (LightRelease.isReleased(this)) null else chooseHost(intent?.getStringExtra(EXTRA_HOST), prefs(this))
        if (host == null) {
            // An intentional stop does not count as a revoked permission.
            stoppedByApp = true
            stopSelf()
            return START_NOT_STICKY
        }
        stoppedByApp = false
        if (!startTunnel(host)) {
            stopSelf() // The VPN permission is gone, onDestroy records it.
            return START_NOT_STICKY
        }
        return START_STICKY
    }

    private fun startTunnel(host: String): Boolean {
        val current = tunnel
        if (current != null && current.alive) {
            current.useHost(host)
            return true
        }
        current?.stop()
        val tun = try {
            establishInterface()
        } catch (e: IllegalStateException) {
            null
        } catch (e: SecurityException) {
            null
        } catch (e: IllegalArgumentException) {
            null
        }
        if (tun == null) {
            Log.w(TAG, "the VPN interface could not be established")
            return false
        }
        val started = Tunnel(tun, DotResolver(host), host) { if (tunnel === it) stopSelf() }
        tunnel = started
        running = true
        started.start()
        VpnEvents.emit(VpnEvent.Started)
        return true
    }

    /** Null when the user has not granted (or has taken back) the VPN permission. */
    private fun establishInterface(): ParcelFileDescriptor? {
        val builder = Builder()
            .setSession(VpnNetwork.SESSION)
            .addAddress(VpnNetwork.CLIENT_V4, 32)
            .addAddress(VpnNetwork.CLIENT_V6, 128)
            .addDnsServer(VpnNetwork.DNS_V4)
            .addDnsServer(VpnNetwork.DNS_V6)
            .setMtu(VpnNetwork.MTU)
            .setBlocking(true)
            .setMetered(false) // the VPN carries almost nothing, so it should not make a Wi-Fi network look metered
        // Only the addresses below enter the tunnel. There is no default route: all other traffic goes straight out.
        for (dns in VpnNetwork.dnsServers) builder.addRoute(dns.toInetAddress(), dns.size * 8)
        for (resolver in ResolverBlocklist.addresses) builder.addRoute(resolver.toInetAddress(), resolver.size * 8)
        try {
            builder.addDisallowedApplication(packageName) // our own DNS-over-TLS connection and lookups must not loop back into the tunnel
        } catch (e: PackageManager.NameNotFoundException) {
            return null // our own package is always installed; this cannot happen
        }
        return builder.establish()
    }

    override fun onRevoke() {
        // The user (or another VPN app) took the permission away. The system stops the interface.
        tunnel?.stop()
        tunnel = null
        reportStopped(revoked = true)
        super.onRevoke() // stopSelf()
    }

    override fun onDestroy() {
        tunnel?.stop()
        tunnel = null
        reportStopped(revoked = !stoppedByApp)
        if (instance === this) instanceRef = null
        super.onDestroy()
    }

    private fun reportStopped(revoked: Boolean) {
        if (instance === this) running = false
        if (stoppedReported) return
        stoppedReported = true
        if (revoked) prefs(this).edit().putLong(KEY_REVOKED_AT, System.currentTimeMillis()).apply()
        VpnEvents.emit(VpnEvent.Stopped)
    }

    /** The open interface, its reader thread and the resolver behind it. */
    private class Tunnel(
        private val tun: ParcelFileDescriptor,
        initial: DotResolver,
        host: String,
        private val onEnded: (Tunnel) -> Unit,
    ) {
        @Volatile private var stopped = false

        private val upstream = SwitchableResolver(initial, host)
        private val forwarder = PacketForwarder(FileInputStream(tun.fileDescriptor), FileOutputStream(tun.fileDescriptor), upstream)
        private val thread = Thread({
            forwarder.run()
            if (!stopped) onEnded(this) // the interface broke without us closing it
        }, "plainphone-vpn")

        val alive: Boolean get() = !stopped && thread.isAlive
        val activeHost: String? get() = upstream.host.takeIf { alive }

        fun start() = thread.start()

        fun useHost(host: String) {
            if (upstream.host != host) upstream.switchTo(host)
        }

        fun stop() {
            stopped = true
            forwarder.close()
            upstream.close()
            try {
                tun.close() // also wakes the thread that is blocked reading it
            } catch (e: IOException) {
                // Already closed.
            }
        }
    }

    /** Lets the host change while the tunnel runs, without tearing the interface down. */
    private class SwitchableResolver(first: DotResolver, @Volatile var host: String) : UpstreamResolver {
        @Volatile private var current: DotResolver = first

        override fun resolve(query: ByteArray): ByteArray = current.resolve(query)

        fun switchTo(newHost: String) {
            val old = current
            current = DotResolver(newHost)
            host = newHost
            old.close()
        }

        fun close() = current.close()
    }

    companion object {
        private const val TAG = "PlainphoneVpn"

        const val PREFS = "plainphone_vpn"
        const val KEY_HOST = "host"

        /** When the VPN was last revoked, taken away or died on us (epoch ms). Not set by [stop]. */
        const val KEY_REVOKED_AT = "vpn_revoked_at"
        const val EXTRA_HOST = "org.plainphone.app.light.vpn.HOST"

        @Volatile private var running = false
        // Weak, so a destroyed service is never kept alive by this static field.
        @Volatile private var instanceRef: WeakReference<PlainphoneVpnService>? = null
        private val instance: PlainphoneVpnService? get() = instanceRef?.get()

        private val HOST = Regex("^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$", RegexOption.IGNORE_CASE)

        private fun prefs(context: Context): SharedPreferences = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

        /** A DNS host name with at least two labels, such as `abc123.dns.plainphone.org`. An IP address is not one. */
        fun isValidHost(host: String): Boolean = HOST.matches(host) && !host.substringAfterLast('.').all { it in '0'..'9' }

        /**
         * The host to use for a start: the one in the intent (and remember it), otherwise the one from the last
         * start. A null intent is how the system restarts a sticky or always-on service.
         */
        internal fun chooseHost(fromIntent: String?, prefs: SharedPreferences): String? {
            val given = fromIntent?.takeIf { isValidHost(it) }
            if (given != null) {
                prefs.edit().putString(KEY_HOST, given).apply()
                return given
            }
            return prefs.getString(KEY_HOST, null)?.takeIf { isValidHost(it) }
        }

        /**
         * Starts the VPN (or points a running one at [host]) and remembers [host] for restarts without an intent.
         * The user must have agreed to the VPN once: see [prepareIntent]. False when Android refuses to start
         * the service now (the app is in the background and not exempt) or [host] is not a host name.
         */
        fun start(context: Context, host: String): Boolean {
            if (!isValidHost(host) || LightRelease.isReleased(context)) return false
            prefs(context).edit().putString(KEY_HOST, host).apply()
            val intent = Intent(context, PlainphoneVpnService::class.java).putExtra(EXTRA_HOST, host)
            return try {
                context.startService(intent) != null
            } catch (e: IllegalStateException) {
                false // started from the background
            } catch (e: SecurityException) {
                false
            }
        }

        /** Stops the VPN on purpose. Unlike a revocation this does not set [KEY_REVOKED_AT]. */
        fun stop(context: Context) {
            instance?.stoppedByApp = true
            context.stopService(Intent(context, PlainphoneVpnService::class.java))
        }

        /** Null when the user has already agreed to the VPN; otherwise the system dialog to start for result. */
        fun prepareIntent(context: Context): Intent? = VpnService.prepare(context)

        /** True while the interface is up. */
        fun isRunning(): Boolean = running

        fun activeHost(): String? = instance?.tunnel?.activeHost

        /**
         * True when Android has this app as the always-on VPN. Asks the running service, because Android only
         * answers that question to the service itself: false while the service is not running.
         */
        @Suppress("UNUSED_PARAMETER") // kept so callers need not know that the answer comes from the running instance
        fun isAlwaysOn(context: Context): Boolean = try {
            instance?.isAlwaysOn ?: false
        } catch (e: RuntimeException) {
            false
        }

        /** True when "Block connections without VPN" is on for this app. Same rule as [isAlwaysOn]. */
        @Suppress("UNUSED_PARAMETER")
        fun isLockdownEnabled(context: Context): Boolean = try {
            instance?.isLockdownEnabled ?: false
        } catch (e: RuntimeException) {
            false
        }

        /** [KEY_REVOKED_AT], or 0 when the VPN has never been revoked. */
        fun lastRevokedAt(context: Context): Long = prefs(context).getLong(KEY_REVOKED_AT, 0L)

        /** The host of the last start. */
        fun lastHost(context: Context): String? = prefs(context).getString(KEY_HOST, null)
    }
}
