# SPDX-License-Identifier: Apache-2.0
# Copyright 2026 The Plainphone authors
"""A tiny DNS-over-TLS client using only the standard library.

It is used by the self-test that feeds monitoring and by the end-to-end tests,
so neither needs dnspython or kdig inside the container.
"""

from __future__ import annotations

import dataclasses
import secrets
import socket
import ssl
import struct
import time

TYPE_A = 1
TYPE_CNAME = 5
TYPE_AAAA = 28
RCODE_NAMES = {0: "NOERROR", 2: "SERVFAIL", 3: "NXDOMAIN", 5: "REFUSED"}


@dataclasses.dataclass
class Answer:
    rcode: str
    a: list[str]
    aaaa: list[str]
    cname: list[str]

    @property
    def blocked(self) -> bool:
        """True when AdGuard answered with its block response (NXDOMAIN or unspecified IP)."""
        if self.rcode == "NXDOMAIN":
            return True
        ips = self.a + self.aaaa
        return bool(ips) and all(ip in ("0.0.0.0", "::") for ip in ips)


def encode_query(name: str, qtype: int, query_id: int | None = None) -> bytes:
    qid = secrets.randbelow(65536) if query_id is None else query_id
    header = struct.pack(">HHHHHH", qid, 0x0100, 1, 0, 0, 0)  # RD set
    qname = b"".join(
        bytes([len(label)]) + label.encode("ascii") for label in name.rstrip(".").split(".")
    ) + b"\x00"
    return header + qname + struct.pack(">HH", qtype, 1)


def _read_name(msg: bytes, offset: int) -> tuple[str, int]:
    labels: list[str] = []
    jumped_end = None
    for _ in range(128):  # loop guard against malicious pointers
        length = msg[offset]
        if length == 0:
            offset += 1
            break
        if length & 0xC0 == 0xC0:
            pointer = struct.unpack(">H", msg[offset:offset + 2])[0] & 0x3FFF
            if jumped_end is None:
                jumped_end = offset + 2
            offset = pointer
            continue
        offset += 1
        labels.append(msg[offset:offset + length].decode("ascii", "replace"))
        offset += length
    else:
        raise ValueError("name compression loop")
    return ".".join(labels), (jumped_end if jumped_end is not None else offset)


def decode_response(msg: bytes) -> Answer:
    _qid, flags, qdcount, ancount, _ns, _ar = struct.unpack(">HHHHHH", msg[:12])
    rcode = RCODE_NAMES.get(flags & 0x000F, str(flags & 0x000F))
    offset = 12
    for _ in range(qdcount):
        _, offset = _read_name(msg, offset)
        offset += 4
    answer = Answer(rcode=rcode, a=[], aaaa=[], cname=[])
    for _ in range(ancount):
        _, offset = _read_name(msg, offset)
        rtype, _rclass, _ttl, rdlength = struct.unpack(">HHIH", msg[offset:offset + 10])
        offset += 10
        rdata = msg[offset:offset + rdlength]
        if rtype == TYPE_A and rdlength == 4:
            answer.a.append(socket.inet_ntop(socket.AF_INET, rdata))
        elif rtype == TYPE_AAAA and rdlength == 16:
            answer.aaaa.append(socket.inet_ntop(socket.AF_INET6, rdata))
        elif rtype == TYPE_CNAME:
            answer.cname.append(_read_name(msg, offset)[0])
        offset += rdlength
    return answer


def query(
    name: str,
    *,
    server: str,
    tls_name: str,
    port: int = 853,
    qtype: int = TYPE_A,
    verify: bool = True,
    ca_file: str | None = None,
    timeout: float = 10.0,
) -> Answer:
    """Send one query over DNS-over-TLS. `tls_name` carries the ClientID (SNI)."""
    ctx = ssl.create_default_context(cafile=ca_file)
    if not verify:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE
    payload = encode_query(name, qtype)
    with socket.create_connection((server, port), timeout=timeout) as raw:
        with ctx.wrap_socket(raw, server_hostname=tls_name) as conn:
            conn.sendall(struct.pack(">H", len(payload)) + payload)
            length = struct.unpack(">H", _recv_exact(conn, 2))[0]
            return decode_response(_recv_exact(conn, length))


def cert_days_left(server: str, tls_name: str, port: int = 853, timeout: float = 10.0) -> float:
    """Days until the served certificate expires (verifies the chain)."""
    ctx = ssl.create_default_context()
    with socket.create_connection((server, port), timeout=timeout) as raw:
        with ctx.wrap_socket(raw, server_hostname=tls_name) as conn:
            cert = conn.getpeercert()
    return (ssl.cert_time_to_seconds(cert["notAfter"]) - time.time()) / 86400


def served_cert_days(server: str, tls_name: str, port: int = 853, timeout: float = 10.0) -> float:
    """Days left on the certificate the server presents, without verifying it.

    Used by the self-test, which connects to the container directly (by its
    compose name, so hostname verification cannot work there).
    """
    import os
    import tempfile

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    with socket.create_connection((server, port), timeout=timeout) as raw:
        with ctx.wrap_socket(raw, server_hostname=tls_name) as conn:
            der = conn.getpeercert(binary_form=True)
    fd, path = tempfile.mkstemp(suffix=".pem")
    try:
        with os.fdopen(fd, "w") as fh:
            fh.write(ssl.DER_cert_to_PEM_cert(der))
        info = ssl._ssl._test_decode_cert(path)  # noqa: SLF001 - stdlib PEM parser
    finally:
        os.unlink(path)
    return (ssl.cert_time_to_seconds(info["notAfter"]) - time.time()) / 86400


def _recv_exact(conn: ssl.SSLSocket, n: int) -> bytes:
    buf = b""
    while len(buf) < n:
        chunk = conn.recv(n - len(buf))
        if not chunk:
            raise ConnectionError("connection closed mid-message")
        buf += chunk
    return buf
