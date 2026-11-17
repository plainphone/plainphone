// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import com.google.common.truth.Truth.assertThat
import org.junit.Assert.assertThrows
import org.junit.Test

/**
 * The packet fixtures below were produced by an independent implementation (Python, struct and a plain
 * RFC 1071 sum), not by the code under test: a query for example.com A with id 0x1234, and the packet that
 * answers it, over IPv4 and IPv6.
 */
class DnsPacketsTest {
    private val query = hex("123401000001000000000000076578616d706c6503636f6d0000010001")
    private val response = hex("123481800001000100000000076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822")

    private val v4Query = hex("4500003900004000401169d20a6fde010a6fde029c4000350025b0aa123401000001000000000000076578616d706c6503636f6d0000010001")
    private val v4Reply = hex("4500004900004000401169c20a6fde020a6fde0100359c4000350613123481800001000100000000076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822")
    private val v4Query8888 = hex("4500003900004000401142340a6fde01080808089c4000350025890c123401000001000000000000076578616d706c6503636f6d0000010001")
    private val v4Reply8888 = hex("450000490000400040114224080808080a6fde0100359c400035de74123481800001000100000000076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822")
    private val v6Query = hex("6000000000251140fd007070000000000000000000000001fd0070700000000000000000000000029c4100350025a6a6123401000001000000000000076578616d706c6503636f6d0000010001")
    private val v6Reply = hex("6000000000351140fd007070000000000000000000000002fd00707000000000000000000000000100359c410035fc0e123481800001000100000000076578616d706c6503636f6d0000010001c00c000100010000003c00045db8d822")

    // ---- Reading ----

    @Test
    fun `the checksum function gives the textbook IPv4 header checksum`() {
        // The example on the Wikipedia page for the IPv4 header checksum: the result is 0xb861.
        val header = hex("45000073000040004011" + "0000" + "c0a80001c0a800c7")
        assertThat(DnsPackets.checksum(header, 0, header.size)).isEqualTo(0xb861)
    }

    @Test
    fun `parses an IPv4 DNS query`() {
        val q = DnsPackets.parseDnsQuery(v4Query)!!
        assertThat(q.version).isEqualTo(4)
        assertThat(q.src).isEqualTo(IpAddress.parse("10.111.222.1"))
        assertThat(q.dst).isEqualTo(IpAddress.parse("10.111.222.2"))
        assertThat(q.srcPort).isEqualTo(40000)
        assertThat(q.dstPort).isEqualTo(53)
        assertThat(q.payload).isEqualTo(query)
    }

    @Test
    fun `parses an IPv6 DNS query`() {
        val q = DnsPackets.parseDnsQuery(v6Query)!!
        assertThat(q.version).isEqualTo(6)
        assertThat(q.src).isEqualTo(IpAddress.parse("fd00:7070::1"))
        assertThat(q.dst).isEqualTo(IpAddress.parse("fd00:7070::2"))
        assertThat(q.srcPort).isEqualTo(40001)
        assertThat(q.dstPort).isEqualTo(53)
        assertThat(q.payload).isEqualTo(query)
    }

    @Test
    fun `reads only the bytes the read returned, not the whole buffer`() {
        val buffer = ByteArray(4096)
        v4Query.copyInto(buffer)
        // Garbage after the packet must not matter, and a length shorter than the packet is not a packet.
        buffer.fill(0x55, v4Query.size, buffer.size)
        assertThat(DnsPackets.parseDnsQuery(buffer, v4Query.size)!!.payload).isEqualTo(query)
        assertThat(DnsPackets.parseDnsQuery(buffer, v4Query.size - 1)).isNull()
    }

    @Test
    fun `skips an IPv6 extension header`() {
        // A hop-by-hop header (next header = UDP, length 0 = 8 bytes) between the IPv6 header and UDP.
        val ext = hex("1100000000000000")
        val withExt = v6Query.copyOfRange(0, 40) + ext + v6Query.copyOfRange(40, v6Query.size)
        withExt[6] = 0 // next header: hop-by-hop
        withExt[5] = (withExt[5] + 8).toByte() // payload length
        val q = DnsPackets.parseDnsQuery(withExt)!!
        assertThat(q.dstPort).isEqualTo(53)
        assertThat(q.payload).isEqualTo(query)
    }

    @Test
    fun `reads an IPv4 header with options`() {
        val options = hex("01010101") // four NOPs
        val withOptions = v4Query.copyOfRange(0, 20) + options + v4Query.copyOfRange(20, v4Query.size)
        withOptions[0] = 0x46.toByte() // header length 6 words
        withOptions[3] = (withOptions[3] + 4).toByte() // total length
        assertThat(DnsPackets.parseDnsQuery(withOptions)!!.payload).isEqualTo(query)
    }

    @Test
    fun `ignores what is not a plain DNS query over UDP`() {
        // UDP to another port.
        assertThat(DnsPackets.parseDnsQuery(withDstPort(v4Query, 123))).isNull()
        // An answer (it goes to the app's port), and a DNS response sent to port 53 (QR bit set), are not queries.
        assertThat(DnsPackets.parseDnsQuery(v4Reply)).isNull()
        assertThat(DnsPackets.parseDnsQuery(withDstPort(v4Reply, 53))).isNull()
        // TCP.
        val tcp = v4Query.copyOf().also { it[9] = 6 }
        assertThat(DnsPackets.parseDnsQuery(tcp)).isNull()
        // Fragments, too short, not IP.
        val fragment = v4Query.copyOf().also { it[6] = 0x20.toByte() } // more fragments
        assertThat(DnsPackets.parseDnsQuery(fragment)).isNull()
        assertThat(DnsPackets.parseDnsQuery(ByteArray(0))).isNull()
        assertThat(DnsPackets.parseDnsQuery(ByteArray(10) { 0x45 })).isNull()
        assertThat(DnsPackets.parseDnsQuery(ByteArray(60) { 0x10 })).isNull()
        // A UDP length that runs past the packet.
        val badLength = v4Query.copyOf().also { it[25] = 0x70 }
        assertThat(DnsPackets.parseDnsQuery(badLength)).isNull()
    }

    private fun withDstPort(packet: ByteArray, port: Int): ByteArray {
        val ip = if (packet[0].toInt() and 0xF0 == 0x40) 20 else 40
        return packet.copyOf().also {
            it[ip + 2] = (port shr 8).toByte()
            it[ip + 3] = port.toByte()
        }
    }

    // ---- Building ----

    @Test
    fun `the IPv4 reply is the packet an independent implementation builds`() {
        val reply = DnsPackets.buildReply(DnsPackets.parseDnsQuery(v4Query)!!, response)
        assertThat(reply).isEqualTo(v4Reply)
    }

    @Test
    fun `the IPv6 reply is the packet an independent implementation builds`() {
        val reply = DnsPackets.buildReply(DnsPackets.parseDnsQuery(v6Query)!!, response)
        assertThat(reply).isEqualTo(v6Reply)
    }

    @Test
    fun `a reply to a public resolver address comes from that address`() {
        val reply = DnsPackets.buildReply(DnsPackets.parseDnsQuery(v4Query8888)!!, response)
        assertThat(reply).isEqualTo(v4Reply8888)
        val parsed = DnsPackets.parseUdp(reply)!!
        assertThat(parsed.src).isEqualTo(IpAddress.parse("8.8.8.8"))
        assertThat(parsed.srcPort).isEqualTo(53)
        assertThat(parsed.dstPort).isEqualTo(40000)
    }

    @Test
    fun `every checksum of a built packet adds up, for any payload length`() {
        for (version in listOf(4, 6)) {
            val src = if (version == 4) IpAddress.parse("10.111.222.2") else IpAddress.parse("fd00:7070::2")
            val dst = if (version == 4) IpAddress.parse("10.111.222.1") else IpAddress.parse("fd00:7070::1")
            for (size in listOf(0, 1, 2, 3, 12, 63, 64, 511, 512, 1001)) {
                val payload = ByteArray(size) { (it * 31 + 7).toByte() }
                val p = DnsPackets.buildUdp(version, src, dst, 53, 41234, payload)
                if (version == 4) assertThat(onesComplementSum(p, 0, 20, 0)).isEqualTo(0xFFFF)
                assertThat(udpChecksumSum(p, version)).isEqualTo(0xFFFF)
                assertThat(DnsPackets.parseUdp(p)!!.payload).isEqualTo(payload)
            }
        }
    }

    @Test
    fun `a UDP checksum that works out to zero is sent as FFFF`() {
        val src = IpAddress.parse("fd00:7070::2")
        val dst = IpAddress.parse("fd00:7070::1")
        // Find a 2-byte payload whose checksum would be 0x0000 and check that the packet carries 0xFFFF instead.
        var found = false
        for (v in 0..0xFFFF) {
            val payload = byteArrayOf((v shr 8).toByte(), v.toByte())
            val p = DnsPackets.buildUdp(6, src, dst, 53, 40001, payload)
            val field = ((p[46].toInt() and 0xFF) shl 8) or (p[47].toInt() and 0xFF)
            assertThat(field).isNotEqualTo(0) // IPv6 forbids a zero checksum
            if (field == 0xFFFF) {
                // A checksum field of FFFF can only come from the special case when the sum without the field is
                // already FFFF (ordinary data never sums to zero after inversion).
                val zeroed = p.copyOf().also { it[46] = 0; it[47] = 0 }
                if (udpChecksumSum(zeroed, 6) == 0xFFFF) found = true
            }
        }
        assertThat(found).isTrue()
    }

    @Test
    fun `refuses to build a packet with mixed address families`() {
        assertThrows(IllegalArgumentException::class.java) {
            DnsPackets.buildUdp(4, IpAddress.parse("10.0.0.1"), IpAddress.parse("fd00::1"), 1, 2, ByteArray(0))
        }
    }

    // ---- DNS messages ----

    @Test
    fun `SERVFAIL keeps the id and the question and clears the answers`() {
        val fail = DnsPackets.servfail(query)!!
        assertThat(DnsPackets.id(fail)).isEqualTo(0x1234)
        assertThat(DnsPackets.rcode(fail)).isEqualTo(2)
        assertThat(fail[2].toInt() and 0x80).isEqualTo(0x80) // QR
        assertThat(fail[2].toInt() and 0x01).isEqualTo(0x01) // RD copied
        assertThat(fail[3].toInt() and 0x80).isEqualTo(0x80) // RA
        assertThat(fail.copyOfRange(4, 12)).isEqualTo(hex("0001000000000000")) // one question, nothing else
        assertThat(fail.copyOfRange(12, fail.size)).isEqualTo(query.copyOfRange(12, query.size))
        assertThat(DnsPackets.queryName(fail)).isEqualTo("example.com")
    }

    @Test
    fun `REFUSED has rcode 5`() {
        assertThat(DnsPackets.rcode(DnsPackets.refused(query)!!)).isEqualTo(5)
    }

    @Test
    fun `a failure for a query with a broken question is a bare header`() {
        val broken = query.copyOfRange(0, 20) // cut inside the name
        val fail = DnsPackets.servfail(broken)!!
        assertThat(fail.size).isEqualTo(12)
        assertThat(DnsPackets.id(fail)).isEqualTo(0x1234)
        assertThat(fail.copyOfRange(4, 6)).isEqualTo(hex("0000"))
        assertThat(DnsPackets.servfail(ByteArray(11))).isNull()
    }

    @Test
    fun `a long answer is cut to a truncated one with the question`() {
        val big = response + ByteArray(2000)
        val cut = DnsPackets.fitForUdp(query, big, 1472)
        assertThat(cut[2].toInt() and 0x02).isEqualTo(0x02) // TC
        assertThat(DnsPackets.rcode(cut)).isEqualTo(0)
        assertThat(DnsPackets.id(cut)).isEqualTo(0x1234)
        assertThat(cut.size).isEqualTo(query.size)
        assertThat(DnsPackets.fitForUdp(query, response, 1472)).isSameInstanceAs(response)
    }

    @Test
    fun `reads the query name and type`() {
        assertThat(DnsPackets.queryName(query)).isEqualTo("example.com")
        assertThat(DnsPackets.queryType(query)).isEqualTo(1)
        val aaaa = query.copyOf().also { it[it.size - 3] = 28 }
        assertThat(DnsPackets.queryType(aaaa)).isEqualTo(28)
        val upper = hex("123401000001000000000000074558414d504c4503434f4d0000010001")
        assertThat(DnsPackets.queryName(upper)).isEqualTo("example.com")
        assertThat(DnsPackets.queryName(ByteArray(5))).isNull()
        // A compression pointer where a label should be is not a valid question.
        assertThat(DnsPackets.queryName(hex("123401000001000000000000c00c00010001"))).isNull()
    }

    @Test
    fun `an address literal parses and a host name does not`() {
        assertThat(IpAddress.parse("2620:fe::fe").size).isEqualTo(16)
        assertThat(IpAddress.parse("9.9.9.9").size).isEqualTo(4)
        assertThrows(IllegalArgumentException::class.java) { IpAddress.parse("dns.google") }
        assertThrows(IllegalArgumentException::class.java) { IpAddress.parse("") }
    }

    @Test
    fun `an address never prints itself`() {
        assertThat(IpAddress.parse("8.8.8.8").toString()).doesNotContain("8.8")
    }

    // ---- Independent verification, written differently from the code under test ----

    /** Sum of 16-bit words with end-around carry, no final inversion. A correct packet gives 0xFFFF. */
    private fun onesComplementSum(b: ByteArray, off: Int, len: Int, initial: Int): Int {
        var total = initial.toLong()
        var i = 0
        while (i < len) {
            val hi = b[off + i].toInt() and 0xFF
            val lo = if (i + 1 < len) b[off + i + 1].toInt() and 0xFF else 0
            total += (hi shl 8) + lo
            i += 2
        }
        while (total > 0xFFFF) total = (total and 0xFFFF) + (total shr 16)
        return total.toInt()
    }

    /** The one's-complement sum over the pseudo-header and the UDP datagram of a packet. */
    private fun udpChecksumSum(p: ByteArray, version: Int): Int {
        val ip = if (version == 4) 20 else 40
        val udpLen = p.size - ip
        val pseudo = if (version == 4) {
            p.copyOfRange(12, 20) + byteArrayOf(0, 17, (udpLen shr 8).toByte(), udpLen.toByte())
        } else {
            p.copyOfRange(8, 40) + byteArrayOf(0, 0, (udpLen shr 8).toByte(), udpLen.toByte(), 0, 0, 0, 17)
        }
        return onesComplementSum(pseudo + p.copyOfRange(ip, p.size), 0, pseudo.size + udpLen, 0)
    }
}

internal fun hex(s: String): ByteArray = ByteArray(s.length / 2) { s.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
