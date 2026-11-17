// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import com.google.common.truth.Truth.assertThat
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.LinkedBlockingQueue
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger
import org.junit.After
import org.junit.Test

/** The tunnel loop with a fake TUN device and a fake upstream. */
class PacketForwarderTest {
    private val query = hex("123401000001000000000000076578616d706c6503636f6d0000010001")
    private val response = hex("123481800001000100000000076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822")
    private val v4Query = hex("4500003900004000401169d20a6fde010a6fde029c4000350025b0aa123401000001000000000000076578616d706c6503636f6d0000010001")
    private val v4Reply = hex("4500004900004000401169c20a6fde020a6fde0100359c4000350613123481800001000100000000076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822")
    private val v6Query = hex("6000000000251140fd007070000000000000000000000001fd0070700000000000000000000000029c4100350025a6a6123401000001000000000000076578616d706c6503636f6d0000010001")
    private val v6Reply = hex("6000000000351140fd007070000000000000000000000002fd00707000000000000000000000000100359c410035fc0e123481800001000100000000076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822")

    /** The "TUN device": packets the test puts in come out of read(), one per call, like a real TUN fd. */
    private class FakeTun : InputStream() {
        private val inbound = LinkedBlockingQueue<ByteArray>()
        val written = LinkedBlockingQueue<ByteArray>()
        private val eof = ByteArray(0)

        fun send(packet: ByteArray) = inbound.put(packet)
        fun end() = inbound.put(eof)

        override fun read(): Int = throw UnsupportedOperationException()
        override fun read(b: ByteArray, off: Int, len: Int): Int {
            val p = inbound.take()
            if (p === eof) return -1
            p.copyInto(b, off)
            return p.size
        }

        val output = object : OutputStream() {
            override fun write(b: Int) = throw UnsupportedOperationException()
            override fun write(b: ByteArray, off: Int, len: Int) {
                written.put(b.copyOfRange(off, off + len))
            }
        }
    }

    private val tun = FakeTun()
    private var forwarder: PacketForwarder? = null
    private var thread: Thread? = null

    private fun start(
        maxInFlight: Int = 8,
        maxQueued: Int = 32,
        now: () -> Long = System::currentTimeMillis,
        resolver: UpstreamResolver,
    ): PacketForwarder {
        val f = PacketForwarder(tun, tun.output, resolver, maxInFlight, maxQueued, staleAfterMs = 5_000, nowMs = now)
        forwarder = f
        thread = Thread { f.run() }.also { it.start() }
        return f
    }

    @After
    fun stop() {
        forwarder?.close()
        tun.end()
        thread?.join(2_000)
    }

    private fun next(): ByteArray = tun.written.poll(5, TimeUnit.SECONDS) ?: error("no packet was written")

    @Test
    fun `a query over IPv4 is answered with the upstream's answer, in the packet an independent implementation builds`() {
        start { q ->
            assertThat(q).isEqualTo(query)
            response
        }
        tun.send(v4Query)
        assertThat(next()).isEqualTo(v4Reply)
    }

    @Test
    fun `a query over IPv6 is answered too`() {
        start { response }
        tun.send(v6Query)
        assertThat(next()).isEqualTo(v6Reply)
    }

    @Test
    fun `when the upstream fails the app gets a SERVFAIL for its own query`() {
        val f = start { throw IOException("no route") }
        tun.send(v4Query)
        val packet = DnsPackets.parseUdp(next())!!
        assertThat(DnsPackets.id(packet.payload)).isEqualTo(0x1234)
        assertThat(DnsPackets.rcode(packet.payload)).isEqualTo(DnsPackets.RCODE_SERVFAIL)
        assertThat(packet.src).isEqualTo(IpAddress.parse("10.111.222.2"))
        assertThat(packet.dstPort).isEqualTo(40000)
        assertThat(f.servfails.get()).isEqualTo(1)
    }

    @Test
    fun `other traffic gets no reply, and TCP to a resolver is dropped`() {
        val calls = AtomicInteger()
        val f = start { calls.incrementAndGet(); response }
        val other = v4Query.copyOf().also { it[16] = 93.toByte(); it[17] = 184.toByte(); it[18] = 216.toByte(); it[19] = 34 } // a stranger's address
        val tcp = v4Query.copyOf().also { it[9] = 6; it[16] = 8; it[17] = 8; it[18] = 8; it[19] = 8 }
        tun.send(other)
        tun.send(tcp)
        tun.send(v4Query) // the marker: when its answer arrives, the two before it have been handled
        assertThat(next()).isEqualTo(v4Reply)
        assertThat(tun.written.poll(300, TimeUnit.MILLISECONDS)).isNull()
        assertThat(calls.get()).isEqualTo(1)
        assertThat(f.dropped.get()).isEqualTo(1)
    }

    @Test
    fun `no more than eight queries are asked upstream at once, and the overflow gets a SERVFAIL at once`() {
        val release = CountDownLatch(1)
        val running = AtomicInteger()
        val peak = AtomicInteger()
        val started = CountDownLatch(8)
        val f = start(maxInFlight = 8, maxQueued = 4) { _ ->
            peak.accumulateAndGet(running.incrementAndGet()) { a, b -> maxOf(a, b) }
            started.countDown()
            release.await(10, TimeUnit.SECONDS)
            running.decrementAndGet()
            response
        }
        repeat(8) { tun.send(v4Query) }
        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue()
        repeat(4) { tun.send(v4Query) } // wait in the queue
        tun.send(v4Query) // one too many: answered at once without asking upstream
        val overflow = DnsPackets.parseUdp(next())!!
        assertThat(DnsPackets.rcode(overflow.payload)).isEqualTo(DnsPackets.RCODE_SERVFAIL)
        assertThat(f.servfails.get()).isEqualTo(1)
        release.countDown()
        repeat(12) { assertThat(DnsPackets.rcode(DnsPackets.parseUdp(next())!!.payload)).isEqualTo(0) }
        assertThat(peak.get()).isEqualTo(8)
    }

    @Test
    fun `a query that waited too long in the queue is dropped without asking upstream`() {
        var clock = 1_000L
        val release = CountDownLatch(1)
        val started = CountDownLatch(1)
        val calls = AtomicInteger()
        val f = start(maxInFlight = 1, maxQueued = 4, now = { clock }) { _ ->
            calls.incrementAndGet()
            started.countDown()
            release.await(10, TimeUnit.SECONDS)
            response
        }
        tun.send(v4Query)
        assertThat(started.await(5, TimeUnit.SECONDS)).isTrue()
        repeat(2) { tun.send(v4Query) } // queued behind the first
        Thread.sleep(200) // let the reader queue them
        clock += 6_000 // longer than the 5 s limit
        release.countDown()
        assertThat(next()).isEqualTo(v4Reply) // the first one
        Thread.sleep(300)
        assertThat(calls.get()).isEqualTo(1)
        assertThat(f.stale.get()).isEqualTo(2)
        assertThat(tun.written.poll(100, TimeUnit.MILLISECONDS)).isNull()
    }

    @Test
    fun `an answer too big for one packet is sent as a truncated answer`() {
        start { response + ByteArray(3000) }
        tun.send(v4Query)
        val packet = DnsPackets.parseUdp(next())!!
        assertThat(packet.payload[2].toInt() and 0x02).isEqualTo(0x02) // TC
        assertThat(packet.payload.size).isEqualTo(query.size)
        assertThat(DnsPackets.id(packet.payload)).isEqualTo(0x1234)
    }

    @Test
    fun `the loop ends when the tunnel closes`() {
        start { response }
        tun.end()
        thread!!.join(2_000)
        assertThat(thread!!.isAlive).isFalse()
    }
}
