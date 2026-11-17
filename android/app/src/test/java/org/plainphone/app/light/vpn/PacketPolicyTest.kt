// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import com.google.common.truth.Truth.assertThat
import org.junit.Test

/** The forwarding decision for each kind of packet that can reach the tunnel. */
class PacketPolicyTest {
    private val dnsQuery = hex("123401000001000000000000076578616d706c6503636f6d0000010001")
    private val dnsResponse = hex("123481800001000100000000076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822")
    private val client4 = IpAddress.parse("10.111.222.1")
    private val client6 = IpAddress.parse("fd00:7070::1")

    private fun udp(dst: String, port: Int, payload: ByteArray = dnsQuery): ByteArray {
        val to = IpAddress.parse(dst)
        val from = if (to.isV4) client4 else client6
        return DnsPackets.buildUdp(if (to.isV4) 4 else 6, from, to, 40000, port, payload)
    }

    /** A minimal TCP segment (a SYN) in an IP packet. The parser never looks inside it. */
    private fun tcp(dst: String, port: Int): ByteArray {
        val to = IpAddress.parse(dst)
        val segment = ByteArray(20)
        segment[0] = 0x9C.toByte(); segment[1] = 0x40 // source port 40000
        segment[2] = (port shr 8).toByte(); segment[3] = port.toByte()
        segment[12] = 0x50 // header length 5 words
        segment[13] = 0x02 // SYN
        return ipPacket(to, 6, segment)
    }

    private fun ipPacket(to: IpAddress, protocol: Int, transport: ByteArray): ByteArray {
        return if (to.isV4) {
            val p = ByteArray(20 + transport.size)
            p[0] = 0x45
            p[2] = (p.size shr 8).toByte(); p[3] = p.size.toByte()
            p[8] = 64; p[9] = protocol.toByte()
            client4.bytes.copyInto(p, 12); to.bytes.copyInto(p, 16)
            transport.copyInto(p, 20)
            p
        } else {
            val p = ByteArray(40 + transport.size)
            p[0] = 0x60
            p[4] = (transport.size shr 8).toByte(); p[5] = transport.size.toByte()
            p[6] = protocol.toByte(); p[7] = 64
            client6.bytes.copyInto(p, 8); to.bytes.copyInto(p, 24)
            transport.copyInto(p, 40)
            p
        }
    }

    private fun forwarded(packet: ByteArray): UdpDatagram {
        val action = PacketPolicy.decide(packet)
        assertThat(action).isInstanceOf(Action.Forward::class.java)
        return (action as Action.Forward).query
    }

    @Test
    fun `DNS to our fake servers is forwarded, over IPv4 and IPv6`() {
        assertThat(forwarded(udp("10.111.222.2", 53)).payload).isEqualTo(dnsQuery)
        assertThat(forwarded(udp("fd00:7070::2", 53)).payload).isEqualTo(dnsQuery)
    }

    @Test
    fun `plain DNS to a public resolver is forwarded, so the filter answers instead`() {
        val q = forwarded(udp("8.8.8.8", 53))
        assertThat(q.dst).isEqualTo(IpAddress.parse("8.8.8.8")) // the reply will come back from the address the app asked
        forwarded(udp("1.1.1.1", 53))
        forwarded(udp("2606:4700:4700::1111", 53))
        forwarded(udp("2620:fe::fe", 53))
        forwarded(udp("94.140.14.14", 53))
    }

    @Test
    fun `everything else sent to a public resolver is dropped`() {
        assertThat(PacketPolicy.decide(tcp("1.1.1.1", 443))).isEqualTo(Action.Drop) // DoH
        assertThat(PacketPolicy.decide(tcp("8.8.8.8", 853))).isEqualTo(Action.Drop) // DoT
        assertThat(PacketPolicy.decide(tcp("9.9.9.9", 53))).isEqualTo(Action.Drop) // DNS over TCP
        assertThat(PacketPolicy.decide(tcp("2001:4860:4860::8888", 443))).isEqualTo(Action.Drop)
        assertThat(PacketPolicy.decide(udp("8.8.8.8", 443, ByteArray(40)))).isEqualTo(Action.Drop) // QUIC or DoQ
        assertThat(PacketPolicy.decide(udp("1.1.1.1", 853, ByteArray(40)))).isEqualTo(Action.Drop) // DoQ
        assertThat(PacketPolicy.decide(ipPacket(IpAddress.parse("8.8.8.8"), 1, ByteArray(8)))).isEqualTo(Action.Drop) // ping
    }

    @Test
    fun `TCP to our own fake DNS servers is dropped too`() {
        assertThat(PacketPolicy.decide(tcp("10.111.222.2", 53))).isEqualTo(Action.Drop)
        assertThat(PacketPolicy.decide(tcp("10.111.222.2", 853))).isEqualTo(Action.Drop) // Android's private DNS probe
    }

    @Test
    fun `a UDP packet to port 53 that is not a query is dropped`() {
        assertThat(PacketPolicy.decide(udp("8.8.8.8", 53, dnsResponse))).isEqualTo(Action.Drop) // QR bit set
        assertThat(PacketPolicy.decide(udp("8.8.8.8", 53, ByteArray(5)))).isEqualTo(Action.Drop) // no DNS header
        assertThat(PacketPolicy.decide(udp("8.8.8.8", 53, ByteArray(0)))).isEqualTo(Action.Drop)
    }

    @Test
    fun `traffic to anything else is ignored`() {
        assertThat(PacketPolicy.decide(udp("93.184.216.34", 53))).isEqualTo(Action.Ignore)
        assertThat(PacketPolicy.decide(tcp("93.184.216.34", 443))).isEqualTo(Action.Ignore)
        assertThat(PacketPolicy.decide(udp("2001:db8::1", 53))).isEqualTo(Action.Ignore)
        assertThat(PacketPolicy.decide(ByteArray(0))).isEqualTo(Action.Ignore)
        assertThat(PacketPolicy.decide(ByteArray(64) { 0x77 })).isEqualTo(Action.Ignore)
    }

    @Test
    fun `a fragment to a resolver is dropped, not forwarded`() {
        val fragment = udp("8.8.8.8", 53).also { it[6] = 0x20.toByte() } // more fragments
        assertThat(PacketPolicy.decide(fragment)).isEqualTo(Action.Drop)
    }

    @Test
    fun `decide reads only the length it is given`() {
        val buffer = ByteArray(2048)
        val packet = udp("8.8.8.8", 53)
        packet.copyInto(buffer)
        assertThat(PacketPolicy.decide(buffer, packet.size)).isInstanceOf(Action.Forward::class.java)
        assertThat(PacketPolicy.decide(buffer, 12)).isEqualTo(Action.Ignore)
    }
}
