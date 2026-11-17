// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 The Plainphone authors
package org.plainphone.app.light.vpn

import java.net.InetAddress

/**
 * An IPv4 or IPv6 address as raw bytes (4 or 16), comparable and hashable.
 * [toString] hides the address on purpose: nothing about a lookup may end up in a log.
 */
class IpAddress private constructor(private val raw: ByteArray) {
    val bytes: ByteArray get() = raw.copyOf()
    val isV4: Boolean get() = raw.size == 4
    val size: Int get() = raw.size

    /** Never resolves a name: the address is built from its bytes. */
    fun toInetAddress(): InetAddress = InetAddress.getByAddress(raw)

    internal fun copyInto(dst: ByteArray, offset: Int) = raw.copyInto(dst, offset)

    override fun equals(other: Any?) = other is IpAddress && raw.contentEquals(other.raw)
    override fun hashCode() = raw.contentHashCode()
    override fun toString() = if (isV4) "IpAddress(v4)" else "IpAddress(v6)"

    companion object {
        fun of(bytes: ByteArray): IpAddress {
            require(bytes.size == 4 || bytes.size == 16) { "an IP address is 4 or 16 bytes" }
            return IpAddress(bytes.copyOf())
        }

        /** Parses a numeric literal such as `8.8.8.8` or `2620:fe::fe`. A host name is rejected, never looked up. */
        fun parse(literal: String): IpAddress {
            require(literal.isNotEmpty() && literal.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' || it == '.' || it == ':' }) {
                "not a numeric IP literal"
            }
            return of(InetAddress.getByName(literal).address)
        }
    }
}

/** The IP header of a packet read from the TUN interface. */
class IpHeader(
    val version: Int,
    /** The transport protocol (IPv6 extension headers are skipped). */
    val protocol: Int,
    val src: IpAddress,
    val dst: IpAddress,
    /** Where the transport header (UDP, TCP...) starts in the packet buffer. */
    val transportOffset: Int,
    val transportLength: Int,
    /** True for any IP fragment. A fragment cannot be read as a whole UDP datagram, so it is never forwarded. */
    val fragment: Boolean,
)

/** A UDP datagram out of a TUN packet. [payload] is a copy, so the read buffer can be reused at once. */
class UdpDatagram(
    val version: Int,
    val src: IpAddress,
    val dst: IpAddress,
    val srcPort: Int,
    val dstPort: Int,
    val payload: ByteArray,
)

/**
 * Pure packet handling for the DNS-only VPN: read IP/UDP packets from the TUN fd, build the reply
 * packet, and build DNS answers (SERVFAIL, truncated). No Android classes, so it runs in plain JUnit.
 */
object DnsPackets {
    const val PROTO_TCP = 6
    const val PROTO_UDP = 17
    const val DNS_PORT = 53

    const val RCODE_SERVFAIL = 2
    const val RCODE_REFUSED = 5

    private const val DNS_HEADER = 12

    // ---- Reading packets ----

    fun parseIp(buf: ByteArray, length: Int = buf.size): IpHeader? {
        if (length < 1 || length > buf.size) return null
        return when (u8(buf, 0) ushr 4) {
            4 -> parseV4(buf, length)
            6 -> parseV6(buf, length)
            else -> null
        }
    }

    private fun parseV4(b: ByteArray, len: Int): IpHeader? {
        if (len < 20) return null
        val ihl = (u8(b, 0) and 0x0F) * 4
        if (ihl < 20 || ihl > len) return null
        val total = u16(b, 2)
        if (total < ihl || total > len) return null
        val fragment = (u16(b, 6) and 0x3FFF) != 0 // more-fragments flag or a non-zero offset
        return IpHeader(
            version = 4,
            protocol = u8(b, 9),
            src = IpAddress.of(b.copyOfRange(12, 16)),
            dst = IpAddress.of(b.copyOfRange(16, 20)),
            transportOffset = ihl,
            transportLength = total - ihl,
            fragment = fragment,
        )
    }

    private fun parseV6(b: ByteArray, len: Int): IpHeader? {
        if (len < 40) return null
        val payloadLength = u16(b, 4)
        val end = if (payloadLength == 0) len else 40 + payloadLength // 0 means a jumbogram, which we only bound by the read
        if (end > len) return null
        var next = u8(b, 6)
        var off = 40
        var fragment = false
        var hops = 0
        while (hops++ < 8) {
            when (next) {
                0, 43, 60 -> { // hop-by-hop, routing, destination options
                    if (off + 8 > end) return null
                    val size = (u8(b, off + 1) + 1) * 8
                    if (off + size > end) return null
                    next = u8(b, off)
                    off += size
                }
                44 -> { // fragment header
                    if (off + 8 > end) return null
                    val field = u16(b, off + 2)
                    if ((field and 0xFFF8) != 0 || (field and 1) != 0) fragment = true
                    next = u8(b, off)
                    off += 8
                }
                51 -> { // authentication header, length in 4-byte units
                    if (off + 8 > end) return null
                    val size = (u8(b, off + 1) + 2) * 4
                    if (off + size > end) return null
                    next = u8(b, off)
                    off += size
                }
                else -> break
            }
        }
        return IpHeader(
            version = 6,
            protocol = next,
            src = IpAddress.of(b.copyOfRange(8, 24)),
            dst = IpAddress.of(b.copyOfRange(24, 40)),
            transportOffset = off,
            transportLength = end - off,
            fragment = fragment,
        )
    }

    /** The UDP datagram in the packet, whatever its port; null when the packet is not a whole UDP datagram. */
    fun parseUdp(buf: ByteArray, ip: IpHeader): UdpDatagram? {
        if (ip.protocol != PROTO_UDP || ip.fragment || ip.transportLength < 8) return null
        val o = ip.transportOffset
        val udpLength = u16(buf, o + 4)
        if (udpLength < 8 || udpLength > ip.transportLength) return null
        return UdpDatagram(
            version = ip.version,
            src = ip.src,
            dst = ip.dst,
            srcPort = u16(buf, o),
            dstPort = u16(buf, o + 2),
            payload = buf.copyOfRange(o + 8, o + udpLength),
        )
    }

    fun parseUdp(buf: ByteArray, length: Int = buf.size): UdpDatagram? {
        val ip = parseIp(buf, length) ?: return null
        return parseUdp(buf, ip)
    }

    /** A DNS query in a UDP packet to port 53 (any destination address), or null. */
    fun parseDnsQuery(buf: ByteArray, length: Int = buf.size): UdpDatagram? {
        val d = parseUdp(buf, length) ?: return null
        return d.takeIf { it.dstPort == DNS_PORT && isQuery(it.payload) }
    }

    /** True for a DNS message long enough to have a header and with the QR bit clear. */
    fun isQuery(dns: ByteArray) = dns.size >= DNS_HEADER && (u8(dns, 2) and 0x80) == 0

    // ---- Building packets ----

    /** Largest UDP payload that fits one packet of [mtu] bytes. */
    fun maxUdpPayload(version: Int, mtu: Int = 1500): Int = mtu - (if (version == 4) 20 else 40) - 8

    /** The packet for [query]'s answer: addresses and ports swapped, checksums filled in. */
    fun buildReply(query: UdpDatagram, dns: ByteArray): ByteArray =
        buildUdp(query.version, query.dst, query.src, query.dstPort, query.srcPort, dns)

    fun buildUdp(version: Int, src: IpAddress, dst: IpAddress, srcPort: Int, dstPort: Int, payload: ByteArray): ByteArray {
        require(version == 4 || version == 6) { "IP version" }
        require(src.size == dst.size && src.isV4 == (version == 4)) { "address family does not match the IP version" }
        val ipHeader = if (version == 4) 20 else 40
        val udpLength = 8 + payload.size
        require(udpLength <= 0xFFFF && ipHeader + udpLength <= 0xFFFF) { "payload too large" }
        val p = ByteArray(ipHeader + udpLength)
        if (version == 4) {
            p[0] = 0x45.toByte() // version 4, header length 5 words
            put16(p, 2, p.size)
            put16(p, 6, 0x4000) // don't fragment
            p[8] = 64 // TTL
            p[9] = PROTO_UDP.toByte()
            src.copyInto(p, 12)
            dst.copyInto(p, 16)
            put16(p, 10, fold(sum(p, 0, 20, 0)))
        } else {
            p[0] = 0x60.toByte()
            put16(p, 4, udpLength)
            p[6] = PROTO_UDP.toByte()
            p[7] = 64 // hop limit
            src.copyInto(p, 8)
            dst.copyInto(p, 24)
        }
        val u = ipHeader
        put16(p, u, srcPort)
        put16(p, u + 2, dstPort)
        put16(p, u + 4, udpLength)
        payload.copyInto(p, u + 8)
        // The UDP checksum covers a pseudo-header (addresses, protocol, length) plus the datagram.
        // It is optional over IPv4 and mandatory over IPv6; a computed zero is sent as 0xFFFF.
        val pseudo = ByteArray(if (version == 4) 12 else 40)
        src.copyInto(pseudo, 0)
        dst.copyInto(pseudo, src.size)
        if (version == 4) {
            pseudo[9] = PROTO_UDP.toByte()
            put16(pseudo, 10, udpLength)
        } else {
            put16(pseudo, 32, udpLength shr 16) // upper-layer packet length, 32 bits
            put16(pseudo, 34, udpLength and 0xFFFF)
            pseudo[39] = PROTO_UDP.toByte() // three zero bytes, then the next header
        }
        val checksum = fold(sum(p, u, udpLength, sum(pseudo, 0, pseudo.size, 0)))
        put16(p, u + 6, if (checksum == 0) 0xFFFF else checksum)
        return p
    }

    /** Internet checksum (RFC 1071) of [length] bytes. */
    fun checksum(buf: ByteArray, offset: Int, length: Int): Int = fold(sum(buf, offset, length, 0))

    // ---- DNS messages ----

    /**
     * A SERVFAIL for [query] (what an app gets when the upstream failed), or null when [query] is
     * too short to have an id. Keeps the id, the opcode, the RD bit and the question.
     */
    fun servfail(query: ByteArray): ByteArray? = failure(query, RCODE_SERVFAIL)

    fun refused(query: ByteArray): ByteArray? = failure(query, RCODE_REFUSED)

    fun failure(query: ByteArray, rcode: Int): ByteArray? {
        if (query.size < DNS_HEADER) return null
        val questionEnd = questionEnd(query)
        val question = if (questionEnd > 0) query.copyOfRange(DNS_HEADER, questionEnd) else ByteArray(0)
        val out = ByteArray(DNS_HEADER + question.size)
        out[0] = query[0]
        out[1] = query[1]
        // QR=1, opcode and RD copied from the query; RA=1 because we do answer recursive queries.
        out[2] = (0x80 or (u8(query, 2) and 0x79)).toByte()
        out[3] = (0x80 or (rcode and 0x0F)).toByte()
        put16(out, 4, if (question.isEmpty()) 0 else u16(query, 4))
        question.copyInto(out, DNS_HEADER)
        return out
    }

    /**
     * [response] as it goes into one packet of at most [maxPayload] bytes. A longer answer becomes a
     * header with the TC bit and the question, so the client knows it did not get everything.
     */
    fun fitForUdp(query: ByteArray, response: ByteArray, maxPayload: Int): ByteArray {
        if (response.size <= maxPayload) return response
        val out = failure(query, 0) ?: return response.copyOf(maxPayload)
        out[2] = (u8(out, 2) or 0x02).toByte() // TC
        return out
    }

    /** The query id (first two bytes), or -1 for a message too short. */
    fun id(dns: ByteArray): Int = if (dns.size < 2) -1 else u16(dns, 0)

    /** The RCODE of a DNS message, or -1 for a message too short. */
    fun rcode(dns: ByteArray): Int = if (dns.size < DNS_HEADER) -1 else u8(dns, 3) and 0x0F

    /**
     * The first question's name in lower case, for debugging in tests and debug builds only.
     * **Never log this in a release build**: a query name is what the child looked up.
     */
    fun queryName(dns: ByteArray): String? {
        if (dns.size < DNS_HEADER || u16(dns, 4) < 1) return null
        val sb = StringBuilder()
        var off = DNS_HEADER
        while (true) {
            if (off >= dns.size) return null
            val len = u8(dns, off)
            if (len == 0) break
            if (len and 0xC0 != 0 || off + 1 + len > dns.size) return null // compression pointers do not occur in questions
            if (sb.isNotEmpty()) sb.append('.')
            for (i in 1..len) sb.append(u8(dns, off + i).toChar().lowercaseChar())
            off += 1 + len
            if (sb.length > 253) return null
        }
        return if (sb.isEmpty()) "." else sb.toString()
    }

    /** The first question's type (1 = A, 28 = AAAA ...), or null. */
    fun queryType(dns: ByteArray): Int? {
        if (dns.size < DNS_HEADER || u16(dns, 4) < 1) return null
        val end = nameEnd(dns, DNS_HEADER)
        return if (end < 0 || end + 4 > dns.size) null else u16(dns, end)
    }

    /** Offset just after the question section, or -1 when it is not well formed. */
    private fun questionEnd(dns: ByteArray): Int {
        val count = u16(dns, 4)
        var off = DNS_HEADER
        repeat(count) {
            off = nameEnd(dns, off)
            if (off < 0 || off + 4 > dns.size) return -1
            off += 4 // type and class
        }
        return off
    }

    /** Offset after the name at [start] (labels only), or -1. */
    private fun nameEnd(dns: ByteArray, start: Int): Int {
        var off = start
        while (true) {
            if (off >= dns.size) return -1
            val len = u8(dns, off)
            if (len == 0) return off + 1
            if (len and 0xC0 != 0) return -1
            off += 1 + len
        }
    }

    // ---- Helpers ----

    private fun u8(b: ByteArray, i: Int) = b[i].toInt() and 0xFF
    private fun u16(b: ByteArray, i: Int) = (u8(b, i) shl 8) or u8(b, i + 1)

    private fun put16(b: ByteArray, i: Int, v: Int) {
        b[i] = (v shr 8).toByte()
        b[i + 1] = v.toByte()
    }

    private fun sum(b: ByteArray, offset: Int, length: Int, start: Long): Long {
        var acc = start
        var i = offset
        val end = offset + length
        while (i + 1 < end) {
            acc += (u8(b, i) shl 8) or u8(b, i + 1)
            i += 2
        }
        if (i < end) acc += u8(b, i) shl 8 // an odd last byte is padded with a zero byte
        return acc
    }

    private fun fold(sum: Long): Int {
        var acc = sum
        while (acc ushr 16 != 0L) acc = (acc and 0xFFFF) + (acc ushr 16)
        return acc.toInt().inv() and 0xFFFF
    }
}
