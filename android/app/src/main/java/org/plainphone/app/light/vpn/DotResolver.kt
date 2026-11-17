// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.InetSocketAddress
import java.net.Socket
import java.util.ArrayDeque
import javax.net.ssl.HostnameVerifier
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLPeerUnverifiedException
import javax.net.ssl.SSLSocket
import javax.net.ssl.SSLSocketFactory

/** Asks one DNS query and returns the answer. Blocking. Throws [IOException] when there is no answer. */
fun interface UpstreamResolver {
    fun resolve(query: ByteArray): ByteArray
}

/** One open connection to the upstream. TLS in production, a plain socket in tests. */
interface DotConnection : Closeable {
    val input: InputStream
    val output: OutputStream

    /** Read timeout for the next exchange. */
    fun setTimeout(millis: Int)
}

fun interface DotConnector {
    /** Opens a connection, finished handshake included, within about [timeoutMs]. */
    fun connect(timeoutMs: Int): DotConnection
}

/** DNS over TCP and TLS: each message is a 2-byte big-endian length and then the message (RFC 7858, RFC 1035 section 4.2.2). */
internal object DotFraming {
    const val MAX_MESSAGE = 0xFFFF

    fun write(out: OutputStream, message: ByteArray) {
        require(message.size in 1..MAX_MESSAGE) { "DNS message size" }
        // One write, so the length and the message leave in one TLS record.
        val frame = ByteArray(2 + message.size)
        frame[0] = (message.size shr 8).toByte()
        frame[1] = message.size.toByte()
        message.copyInto(frame, 2)
        out.write(frame)
        out.flush()
    }

    fun read(input: InputStream): ByteArray {
        val hi = input.read()
        val lo = input.read()
        if (hi < 0 || lo < 0) throw EOFException("connection closed")
        val size = (hi shl 8) or lo
        if (size == 0) throw IOException("empty DNS message")
        val message = ByteArray(size)
        var done = 0
        while (done < size) {
            val n = input.read(message, done, size - done)
            if (n < 0) throw EOFException("connection closed in a message")
            done += n
        }
        return message
    }
}

private fun Closeable.closeQuietly() {
    try {
        close()
    } catch (e: IOException) {
        // Nothing to do: the connection is gone either way.
    }
}

private class SocketConnection(private val socket: Socket) : DotConnection {
    override val input: InputStream get() = socket.getInputStream()
    override val output: OutputStream get() = socket.getOutputStream()
    override fun setTimeout(millis: Int) {
        socket.soTimeout = millis
    }

    override fun close() = socket.close()
}

/**
 * The real connector: TLS 1.2 or 1.3 to `host:853`, SNI and certificate checked against [host]
 * (endpoint identification "HTTPS", and once more with the platform's hostname verifier).
 * The host's addresses come from the system resolver. Plainphone itself is kept out of the VPN, so this
 * lookup and the connection do not go through the tunnel.
 */
class TlsConnector(
    private val host: String,
    private val port: Int = 853,
    private val factory: SSLSocketFactory = SSLSocketFactory.getDefault() as SSLSocketFactory,
    private val verifier: HostnameVerifier = HttpsURLConnection.getDefaultHostnameVerifier(),
) : DotConnector {
    override fun connect(timeoutMs: Int): DotConnection {
        val deadline = System.nanoTime() + timeoutMs * 1_000_000L
        var last: IOException? = null
        for (address in InetAddress.getAllByName(host).take(MAX_ADDRESSES)) {
            val remaining = remainingMs(deadline)
            if (remaining <= 0) break
            val plain = Socket()
            try {
                plain.tcpNoDelay = true
                plain.connect(InetSocketAddress(address, port), minOf(remaining, CONNECT_SLICE_MS))
                plain.soTimeout = remainingMs(deadline).coerceAtLeast(1)
                val tls = factory.createSocket(plain, host, port, true) as SSLSocket
                val params = tls.sslParameters
                params.endpointIdentificationAlgorithm = "HTTPS"
                val supported = tls.supportedProtocols.toSet()
                params.protocols = listOf("TLSv1.3", "TLSv1.2").filter { it in supported }.toTypedArray()
                tls.sslParameters = params
                tls.startHandshake()
                if (!verifier.verify(host, tls.session)) throw SSLPeerUnverifiedException("certificate does not match the host")
                return SocketConnection(tls)
            } catch (e: IOException) {
                last = e
                plain.closeQuietly()
            }
        }
        throw last ?: IOException("could not connect")
    }

    private fun remainingMs(deadline: Long): Int = ((deadline - System.nanoTime()) / 1_000_000L).coerceIn(0L, Int.MAX_VALUE.toLong()).toInt()

    private companion object {
        const val MAX_ADDRESSES = 3
        const val CONNECT_SLICE_MS = 3_000
    }
}

/**
 * DNS-over-TLS client with a few connections kept open for the next query.
 *
 * - A query takes an idle connection (or opens a new one) and gives it back afterwards; at most
 *   [maxIdle] idle connections are kept and each is dropped after [idleTimeoutMs] unused.
 * - [queryTimeoutMs] is the read timeout per attempt. A failed attempt closes its connection and the query
 *   is tried once more on a fresh one (a pooled connection the server has closed shows up as a failure).
 * - Failure after the retry is an [IOException]; the caller answers SERVFAIL.
 *
 * Thread-safe. The upstream is `<id>.dns.plainphone.org`, the phone's own DNS name.
 */
class DotResolver(
    private val connector: DotConnector,
    private val maxIdle: Int = 4,
    private val idleTimeoutMs: Long = 30_000,
    private val queryTimeoutMs: Int = 5_000,
    private val nowMs: () -> Long = System::currentTimeMillis,
) : UpstreamResolver, Closeable {
    constructor(host: String) : this(TlsConnector(host))

    private class Idle(val connection: DotConnection, val since: Long)

    private val lock = Any()
    private val idle = ArrayDeque<Idle>()
    private var closed = false

    /** Connections waiting for the next query. */
    internal fun idleCount(): Int = synchronized(lock) { idle.size }

    override fun resolve(query: ByteArray): ByteArray {
        require(query.size >= 12) { "not a DNS message" }
        var failure: IOException? = null
        for (attempt in 0..1) {
            val reused = if (attempt == 0) checkout() else null
            val connection = reused ?: try {
                connector.connect(queryTimeoutMs)
            } catch (e: IOException) {
                failure = e
                continue
            }
            try {
                val answer = exchange(connection, query)
                release(connection)
                return answer
            } catch (e: IOException) {
                failure = e
                connection.closeQuietly()
            } catch (e: RuntimeException) {
                connection.closeQuietly()
                throw e
            }
        }
        throw failure ?: IOException("no answer")
    }

    private fun exchange(connection: DotConnection, query: ByteArray): ByteArray {
        connection.setTimeout(queryTimeoutMs)
        DotFraming.write(connection.output, query)
        val answer = DotFraming.read(connection.input)
        // One query per connection at a time, so the answer must be ours. Anything else is a broken peer.
        if (answer.size < 12 || DnsPackets.id(answer) != DnsPackets.id(query)) throw IOException("unexpected DNS answer")
        return answer
    }

    private fun checkout(): DotConnection? {
        val expired = ArrayList<DotConnection>()
        val taken = synchronized(lock) {
            dropExpired(expired)
            idle.pollLast()?.connection // the most recently used connection is the most likely to be alive
        }
        expired.forEach { it.closeQuietly() }
        return taken
    }

    private fun release(connection: DotConnection) {
        val surplus = ArrayList<DotConnection>()
        synchronized(lock) {
            dropExpired(surplus)
            if (closed || idle.size >= maxIdle) {
                surplus.add(connection)
            } else {
                idle.addLast(Idle(connection, nowMs()))
            }
        }
        surplus.forEach { it.closeQuietly() }
    }

    private fun dropExpired(into: MutableList<DotConnection>) {
        val now = nowMs()
        val it = idle.iterator()
        while (it.hasNext()) {
            val entry = it.next()
            if (now - entry.since >= idleTimeoutMs) {
                it.remove()
                into.add(entry.connection)
            }
        }
    }

    /** Closes the idle connections. A query in flight finishes and then closes its connection. */
    override fun close() {
        val all = ArrayList<DotConnection>()
        synchronized(lock) {
            closed = true
            idle.forEach { all.add(it.connection) }
            idle.clear()
        }
        all.forEach { it.closeQuietly() }
    }
}
