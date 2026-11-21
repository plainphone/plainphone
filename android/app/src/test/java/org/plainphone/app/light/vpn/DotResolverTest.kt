// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import com.google.common.truth.Truth.assertThat
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.Closeable
import java.io.EOFException
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The resolver against a DNS-over-TCP server on the loopback interface. TLS is the platform's job; what is
 * tested here is the framing, the connection pool, the retry and the timeouts, with a plain socket in place
 * of the TLS one.
 */
class DotResolverTest {
    private val query = hex("123401000001000000000000076578616d706c6503636f6d0000010001")

    // ---- Framing ----

    @Test
    fun `a message goes out with a two-byte length in front of it`() {
        val out = ByteArrayOutputStream()
        DotFraming.write(out, query)
        val bytes = out.toByteArray()
        assertThat(bytes.size).isEqualTo(2 + query.size)
        assertThat(bytes[0].toInt()).isEqualTo(0)
        assertThat(bytes[1].toInt()).isEqualTo(query.size)
        assertThat(bytes.copyOfRange(2, bytes.size)).isEqualTo(query)
    }

    @Test
    fun `a long message has a two-byte length`() {
        val big = ByteArray(300) { 1 }
        val out = ByteArrayOutputStream()
        DotFraming.write(out, big)
        assertThat(out.toByteArray().copyOfRange(0, 2)).isEqualTo(byteArrayOf(0x01, 0x2C))
    }

    @Test
    fun `reading takes exactly one message, also when the bytes arrive one by one`() {
        val framed = byteArrayOf(0, query.size.toByte()) + query + byteArrayOf(0, 2, 9, 9)
        val trickle = object : InputStream() {
            private val inner = ByteArrayInputStream(framed)
            override fun read() = inner.read()
            override fun read(b: ByteArray, off: Int, len: Int) = inner.read(b, off, minOf(len, 1))
        }
        assertThat(DotFraming.read(trickle)).isEqualTo(query)
        assertThat(DotFraming.read(trickle)).isEqualTo(byteArrayOf(9, 9)) // the next message is untouched
    }

    @Test
    fun `a closed connection or a cut message is an error`() {
        assertThrows(EOFException::class.java) { DotFraming.read(ByteArrayInputStream(ByteArray(0))) }
        assertThrows(EOFException::class.java) { DotFraming.read(ByteArrayInputStream(byteArrayOf(0))) }
        assertThrows(EOFException::class.java) { DotFraming.read(ByteArrayInputStream(byteArrayOf(0, 10, 1, 2, 3))) }
        assertThrows(IOException::class.java) { DotFraming.read(ByteArrayInputStream(byteArrayOf(0, 0))) }
    }

    // ---- Pool, retry and timeouts against a local server ----

    private val servers = mutableListOf<FakeServer>()
    private val resolvers = mutableListOf<Closeable>()

    @After
    fun cleanUp() {
        resolvers.forEach { it.close() }
        servers.forEach { it.close() }
    }

    private fun server(configure: FakeServer.() -> Unit = {}): FakeServer = FakeServer().also { configure(it); it.start(); servers += it }

    private fun resolver(server: FakeServer, now: () -> Long = System::currentTimeMillis, maxIdle: Int = 4, timeoutMs: Int = 2_000) =
        DotResolver(PlainConnector(server.port), maxIdle = maxIdle, idleTimeoutMs = 30_000, queryTimeoutMs = timeoutMs, nowMs = now)
            .also { resolvers += it }

    @Test
    fun `answers a query and keeps the connection for the next one`() {
        val s = server()
        val r = resolver(s)
        repeat(3) {
            val answer = r.resolve(query)
            assertThat(DnsPackets.id(answer)).isEqualTo(0x1234)
            assertThat(answer[2].toInt() and 0x80).isEqualTo(0x80)
        }
        assertThat(s.accepted.get()).isEqualTo(1)
        assertThat(r.idleCount()).isEqualTo(1)
    }

    @Test
    fun `the idle sweep closes an unused connection after the idle time without a new lookup`() {
        var clock = 0L
        val r = resolver(server(), now = { clock })
        r.resolve(query)
        clock = 29_999
        r.sweepIdle()
        assertThat(r.idleCount()).isEqualTo(1)
        clock = 30_000
        r.sweepIdle()
        assertThat(r.idleCount()).isEqualTo(0)
    }

    @Test
    fun `many lookups keep one idle sweep waiting, not one per lookup`() {
        var clock = 0L
        val r = resolver(server(), now = { clock })
        assertThat(r.sweepScheduled()).isFalse()
        repeat(5) { r.resolve(query) }
        assertThat(r.sweepScheduled()).isTrue()
        clock = 30_000
        r.sweepIdle() // the timer fired and the pool is empty: nothing waits until the next release
        assertThat(r.sweepScheduled()).isFalse()
        r.resolve(query)
        assertThat(r.sweepScheduled()).isTrue()
    }

    @Test
    fun `retries once on a fresh connection when the server closed the pooled one`() {
        val s = server { closeAfterMessages = 1 } // answers one query per connection, then hangs up
        val r = resolver(s)
        r.resolve(query)
        assertThat(r.idleCount()).isEqualTo(1) // the connection we think is alive
        val answer = r.resolve(query) // the pooled one is dead: fails, then succeeds on a new one
        assertThat(DnsPackets.id(answer)).isEqualTo(0x1234)
        assertThat(s.accepted.get()).isEqualTo(2)
    }

    @Test
    fun `gives up after the retry, with an IOException`() {
        val s = server { alwaysCloseWithoutAnswer = true }
        val r = resolver(s)
        assertThrows(IOException::class.java) { r.resolve(query) }
        assertThat(s.accepted.get()).isEqualTo(2) // the attempt and the one retry
        assertThat(r.idleCount()).isEqualTo(0)
    }

    @Test
    fun `a server that never answers times out`() {
        val s = server { silent = true }
        val r = resolver(s, timeoutMs = 150)
        val started = System.nanoTime()
        assertThrows(IOException::class.java) { r.resolve(query) }
        val tookMs = (System.nanoTime() - started) / 1_000_000
        assertThat(tookMs).isAtLeast(250) // two attempts of 150 ms
        assertThat(tookMs).isLessThan(3_000)
        assertThat(r.idleCount()).isEqualTo(0)
    }

    @Test
    fun `an answer with someone else's id is refused`() {
        val s = server { wrongId = true }
        val r = resolver(s)
        assertThrows(IOException::class.java) { r.resolve(query) }
        assertThat(r.idleCount()).isEqualTo(0)
    }

    @Test
    fun `an idle connection is dropped after the idle timeout`() {
        var clock = 1_000_000L
        val s = server()
        val r = resolver(s, now = { clock })
        r.resolve(query)
        clock += 29_000
        r.resolve(query) // still fresh: reused
        assertThat(s.accepted.get()).isEqualTo(1)
        clock += 31_000
        r.resolve(query) // expired: closed, a new connection opened
        assertThat(s.accepted.get()).isEqualTo(2)
        assertThat(r.idleCount()).isEqualTo(1)
    }

    @Test
    fun `keeps at most four connections open`() {
        val s = server { holdAnswersUntil = CountDownLatch(1) }
        val r = resolver(s, timeoutMs = 10_000)
        val threads = (1..6).map { Thread { r.resolve(query) }.also { t -> t.start() } }
        assertThat(s.arrived.await(10, TimeUnit.SECONDS)).isTrue() // 6 queries in flight, so 6 connections
        assertThat(s.accepted.get()).isEqualTo(6)
        s.holdAnswersUntil!!.countDown()
        threads.forEach { it.join(10_000) }
        assertThat(r.idleCount()).isEqualTo(4)
    }

    @Test
    fun `close drops the idle connections and later connections are not kept`() {
        val s = server()
        val r = resolver(s)
        r.resolve(query)
        assertThat(r.idleCount()).isEqualTo(1)
        r.close()
        assertThat(r.idleCount()).isEqualTo(0)
        r.resolve(query) // still answers, but does not pool
        assertThat(r.idleCount()).isEqualTo(0)
    }

    @Test
    fun `refuses something that is not a DNS message`() {
        val r = resolver(server())
        assertThrows(IllegalArgumentException::class.java) { r.resolve(ByteArray(5)) }
    }

    // ---- Test doubles ----

    private class PlainConnector(private val port: Int) : DotConnector {
        override fun connect(timeoutMs: Int): DotConnection {
            val socket = Socket()
            socket.connect(java.net.InetSocketAddress(InetAddress.getLoopbackAddress(), port), timeoutMs)
            return object : DotConnection {
                override val input: InputStream = socket.getInputStream()
                override val output: OutputStream = socket.getOutputStream()
                override fun setTimeout(millis: Int) {
                    socket.soTimeout = millis
                }

                override fun close() = socket.close()
            }
        }
    }

    /** A DNS-over-TCP server: answers every query with its own id and the QR bit set. */
    private class FakeServer : Closeable {
        private val socket = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
        val port: Int get() = socket.localPort
        val accepted = AtomicInteger()
        val arrived = CountDownLatch(6)

        @Volatile var closeAfterMessages = 0
        @Volatile var alwaysCloseWithoutAnswer = false
        @Volatile var silent = false
        @Volatile var wrongId = false
        @Volatile var holdAnswersUntil: CountDownLatch? = null

        fun start() {
            Thread {
                try {
                    while (true) {
                        val client = socket.accept()
                        accepted.incrementAndGet()
                        Thread { serve(client) }.apply { isDaemon = true }.start()
                    }
                } catch (e: IOException) {
                    // closed
                }
            }.apply { isDaemon = true }.start()
        }

        private fun serve(client: Socket) {
            try {
                client.use {
                    var served = 0
                    while (true) {
                        val q = DotFraming.read(client.getInputStream())
                        arrived.countDown()
                        if (alwaysCloseWithoutAnswer) return
                        holdAnswersUntil?.await(10, TimeUnit.SECONDS)
                        if (silent) {
                            Thread.sleep(5_000)
                            return
                        }
                        val a = q.copyOf()
                        a[2] = (a[2].toInt() or 0x80).toByte()
                        if (wrongId) a[0] = (a[0] + 1).toByte()
                        DotFraming.write(client.getOutputStream(), a)
                        served++
                        if (closeAfterMessages in 1..served) return
                    }
                }
            } catch (e: IOException) {
                // the client went away
            } catch (e: InterruptedException) {
                // the test ended
            }
        }

        override fun close() = socket.close()
    }
}
