// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import java.io.Closeable
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicLong

/** The addresses of the VPN interface and of the DNS servers it announces. */
object VpnNetwork {
    const val SESSION = "Plainphone filter"
    const val MTU = 1500
    const val CLIENT_V4 = "10.111.222.1"
    const val CLIENT_V6 = "fd00:7070::1"
    const val DNS_V4 = "10.111.222.2"
    const val DNS_V6 = "fd00:7070::2"

    /** The two DNS servers that apps are told to use while the VPN is up. */
    val dnsServers: Set<IpAddress> = setOf(IpAddress.parse(DNS_V4), IpAddress.parse(DNS_V6))
}

/** What to do with one packet read from the tunnel. */
sealed interface Action {
    /** A DNS query over UDP to one of our DNS servers or to a well-known public resolver: answer it from the upstream. */
    class Forward(val query: UdpDatagram) : Action

    /** Aimed at one of our DNS servers or at a public resolver, but not a plain DNS query (TCP, DoH, DoT, QUIC, ping...): drop it silently. */
    data object Drop : Action

    /** Not for us. Only the routes of the VPN bring packets here, so this is rare (IPv6 neighbour discovery, for one). */
    data object Ignore : Action
}

object PacketPolicy {
    /** True for an address whose traffic the VPN takes over. */
    fun isIntercepted(dst: IpAddress): Boolean = dst in VpnNetwork.dnsServers || ResolverBlocklist.contains(dst)

    /** [length] bytes of [packet] as read from the TUN fd. */
    fun decide(packet: ByteArray, length: Int = packet.size): Action {
        val ip = DnsPackets.parseIp(packet, length) ?: return Action.Ignore
        if (!isIntercepted(ip.dst)) return Action.Ignore
        val udp = DnsPackets.parseUdp(packet, ip)
        if (udp != null && udp.dstPort == DnsPackets.DNS_PORT && DnsPackets.isQuery(udp.payload)) return Action.Forward(udp)
        return Action.Drop
    }
}

/**
 * The tunnel loop without Android in it: reads packets from [input] (the TUN fd), answers DNS queries
 * from [resolver] on a small pool, writes the reply packets to [output]. At most [maxInFlight] queries
 * are asked upstream at once, a further [maxQueued] wait for a free worker, and anything beyond that gets a
 * SERVFAIL at once. When the upstream fails the app gets a SERVFAIL too, so it never hangs on us.
 *
 * Nothing here logs: a DNS name or an address must not reach the log.
 */
class PacketForwarder(
    private val input: InputStream,
    private val output: OutputStream,
    private val resolver: UpstreamResolver,
    private val maxInFlight: Int = 8,
    private val maxQueued: Int = 32,
    /** A query that waited this long in the queue is dropped: the app has asked again or given up. */
    private val staleAfterMs: Long = 5_000,
    private val mtu: Int = VpnNetwork.MTU,
    private val nowMs: () -> Long = System::currentTimeMillis,
) : Closeable {
    val forwarded = AtomicLong()
    val servfails = AtomicLong()
    val dropped = AtomicLong()
    val stale = AtomicLong()

    @Volatile private var closed = false

    private val executor = ThreadPoolExecutor(
        maxInFlight, maxInFlight, 0L, TimeUnit.MILLISECONDS,
        ArrayBlockingQueue(maxQueued),
        ThreadFactory { r -> Thread(r, "plainphone-dns").apply { isDaemon = true } },
    )

    /** Blocks until the input ends or fails, or [close] is called. */
    fun run() {
        val buf = ByteArray(BUFFER)
        while (!closed) {
            val n = try {
                input.read(buf)
            } catch (e: IOException) {
                break
            }
            if (n < 0) break
            if (n == 0) continue
            when (val action = PacketPolicy.decide(buf, n)) {
                is Action.Forward -> submit(action.query)
                Action.Drop -> dropped.incrementAndGet()
                Action.Ignore -> Unit
            }
        }
    }

    private fun submit(query: UdpDatagram) {
        val queuedAt = nowMs()
        try {
            executor.execute { handle(query, queuedAt) }
        } catch (e: RejectedExecutionException) {
            if (!closed) fail(query)
        }
    }

    private fun handle(query: UdpDatagram, queuedAt: Long) {
        if (closed) return
        if (nowMs() - queuedAt > staleAfterMs) {
            stale.incrementAndGet()
            return
        }
        val answer = try {
            resolver.resolve(query.payload)
        } catch (e: Exception) {
            null
        }
        if (answer != null) {
            forwarded.incrementAndGet()
            reply(query, DnsPackets.fitForUdp(query.payload, answer, DnsPackets.maxUdpPayload(query.version, mtu)))
        } else {
            fail(query)
        }
    }

    private fun fail(query: UdpDatagram) {
        servfails.incrementAndGet()
        reply(query, DnsPackets.servfail(query.payload))
    }

    private fun reply(query: UdpDatagram, dns: ByteArray?) {
        if (dns == null || closed) return
        val packet = DnsPackets.buildReply(query, dns)
        try {
            synchronized(output) {
                output.write(packet)
                output.flush()
            }
        } catch (e: IOException) {
            // The tunnel is gone; the read loop ends on its own.
        }
    }

    override fun close() {
        closed = true
        executor.shutdownNow()
    }

    private companion object {
        const val BUFFER = 32 * 1024
    }
}
