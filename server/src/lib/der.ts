// SPDX-License-Identifier: Apache-2.0
//
// A minimal DER reader, enough for X.509 extensions and the Android key attestation record.
// Throws on anything malformed; callers treat a throw as "cannot be verified".

export interface Tlv {
  /** 0 universal, 1 application, 2 context, 3 private. */
  cls: number;
  constructed: boolean;
  /** Tag number, also for high tag numbers such as [704]. */
  tag: number;
  value: Buffer;
  /** The whole element, header included. */
  raw: Buffer;
}

export function readTlv(buf: Buffer, offset = 0): { tlv: Tlv; next: number } {
  let i = offset;
  const need = (n: number) => {
    if (i + n > buf.length) throw new Error("DER: truncated");
  };
  need(2);
  const first = buf[i++]!;
  const cls = first >> 6;
  const constructed = (first & 0x20) !== 0;
  let tag = first & 0x1f;
  if (tag === 0x1f) {
    tag = 0;
    for (let n = 0; ; n++) {
      need(1);
      const b = buf[i++]!;
      if (n > 4) throw new Error("DER: tag too long");
      tag = tag * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
  }
  need(1);
  let len = buf[i++]!;
  if (len & 0x80) {
    const n = len & 0x7f;
    if (n === 0 || n > 4) throw new Error("DER: bad length");
    need(n);
    len = 0;
    for (let k = 0; k < n; k++) len = len * 256 + buf[i++]!;
  }
  need(len);
  const value = buf.subarray(i, i + len);
  return { tlv: { cls, constructed, tag, value, raw: buf.subarray(offset, i + len) }, next: i + len };
}

/** The elements inside a constructed value (a SEQUENCE, SET or explicit tag). */
export function children(value: Buffer): Tlv[] {
  const out: Tlv[] = [];
  let i = 0;
  while (i < value.length) {
    const { tlv, next } = readTlv(value, i);
    out.push(tlv);
    i = next;
  }
  return out;
}

export function asInt(t: Tlv): number {
  if (t.cls !== 0 || (t.tag !== 2 && t.tag !== 10)) throw new Error("DER: not an INTEGER/ENUMERATED");
  if (t.value.length > 6) throw new Error("DER: integer too large");
  let n = 0;
  for (const b of t.value) n = n * 256 + b;
  // Negative numbers do not occur in the fields read here.
  if (t.value.length && t.value[0]! & 0x80) throw new Error("DER: negative integer");
  return n;
}

export function asBool(t: Tlv): boolean {
  if (t.cls !== 0 || t.tag !== 1 || t.value.length !== 1) throw new Error("DER: not a BOOLEAN");
  return t.value[0] !== 0;
}

export function asOctets(t: Tlv): Buffer {
  if (t.cls !== 0 || t.tag !== 4) throw new Error("DER: not an OCTET STRING");
  return t.value;
}

/** Dotted OID text of an OBJECT IDENTIFIER element. */
export function asOid(t: Tlv): string {
  if (t.cls !== 0 || t.tag !== 6) throw new Error("DER: not an OID");
  const v = t.value;
  const parts: number[] = [];
  let n = 0;
  for (const b of v) {
    n = n * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) {
      parts.push(n);
      n = 0;
    }
  }
  const first = parts.shift() ?? 0;
  return [Math.min(2, Math.floor(first / 40)), first - Math.min(2, Math.floor(first / 40)) * 40, ...parts].join(".");
}

/** The DER value of the X.509 extension [oid] in a certificate, or null. */
export function certificateExtension(certDer: Buffer, oid: string): Buffer | null {
  const cert = readTlv(certDer).tlv;
  const tbs = children(cert.value)[0];
  if (!tbs) throw new Error("X.509: no TBSCertificate");
  const ext = children(tbs.value).find((t) => t.cls === 2 && t.tag === 3);
  if (!ext) return null;
  const list = children(ext.value)[0];
  if (!list) return null;
  for (const e of children(list.value)) {
    const parts = children(e.value);
    if (parts[0] && asOid(parts[0]) === oid) return asOctets(parts[parts.length - 1]!);
  }
  return null;
}
