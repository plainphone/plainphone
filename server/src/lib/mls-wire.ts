// SPDX-License-Identifier: Apache-2.0
//
// The clear framing of MLS messages (RFC 9420 §6, §12.4.3.1, §10), which the E2EE prototype's
// delivery service needs for ordering: wire format, group ID, epoch and content type. It reads
// nothing that is encrypted. Vectors: docs/encryption-test-vectors/mls-prototype.json.

export const WIRE = { privateMessage: 2, welcome: 3 } as const;
export const CONTENT = { application: 1, proposal: 2, commit: 3 } as const;
/** MLS_128_DHKEMX25519_AES128GCM_SHA256_Ed25519, the prototype's only suite. */
export const CIPHERSUITE = 1;

export class MlsWireError extends Error {}

export type MlsHeader =
  | { wireFormat: 2; groupId: Uint8Array; epoch: number; contentType: number }
  | { wireFormat: 3; cipherSuite: number };

class Reader {
  private at = 0;
  constructor(private readonly b: Uint8Array) {}
  u8(): number {
    if (this.at + 1 > this.b.length) throw new MlsWireError("truncated");
    return this.b[this.at++]!;
  }
  u16(): number {
    return (this.u8() << 8) | this.u8();
  }
  u64(): bigint {
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(this.u8());
    return v;
  }
  /** A variable-length vector with the RFC 9420 §2.1.2 length prefix, minimal encoding only. */
  vector(): Uint8Array {
    const first = this.u8();
    const prefix = first >> 6;
    let len = first & 0x3f;
    if (prefix === 3) throw new MlsWireError("invalid length prefix");
    for (let i = 0; i < (prefix === 0 ? 0 : prefix === 1 ? 1 : 3); i++) len = len * 256 + this.u8();
    const min = prefix === 1 ? 64 : prefix === 2 ? 16384 : 0;
    if (len < min) throw new MlsWireError("non-minimal length");
    if (this.at + len > this.b.length) throw new MlsWireError("truncated");
    const out = this.b.subarray(this.at, this.at + len);
    this.at += len;
    return out;
  }
  done(): boolean {
    return this.at === this.b.length;
  }
}

/** Parses the clear header. Throws MlsWireError for anything the prototype does not accept. */
export function parseMlsHeader(bytes: Uint8Array): MlsHeader {
  const r = new Reader(bytes);
  if (r.u16() !== 1) throw new MlsWireError("unsupported version");
  const wireFormat = r.u16();
  if (wireFormat === WIRE.privateMessage) {
    const groupId = r.vector();
    const epoch = r.u64();
    const contentType = r.u8();
    r.vector(); // authenticated_data
    r.vector(); // encrypted_sender_data
    r.vector(); // ciphertext
    if (!r.done()) throw new MlsWireError("trailing bytes");
    if (epoch > BigInt(Number.MAX_SAFE_INTEGER)) throw new MlsWireError("epoch out of range");
    if (![CONTENT.application, CONTENT.proposal, CONTENT.commit].includes(contentType as 1)) {
      throw new MlsWireError("unknown content type");
    }
    return { wireFormat, groupId, epoch: Number(epoch), contentType };
  }
  if (wireFormat === WIRE.welcome) {
    const cipherSuite = r.u16();
    r.vector(); // secrets
    r.vector(); // encrypted_group_info
    if (!r.done()) throw new MlsWireError("trailing bytes");
    return { wireFormat, cipherSuite };
  }
  throw new MlsWireError("wire format not accepted");
}

/**
 * A bare KeyPackage (RFC 9420 §10, no MLSMessage wrapper) for the prototype's suite. Only the
 * prefix is read: version, cipher_suite and init_key. The clients validate the signature and
 * the roster binding; the server only refuses what can never be valid.
 */
export function isKeyPackage(bytes: Uint8Array): boolean {
  try {
    const r = new Reader(bytes);
    if (r.u16() !== 1 || r.u16() !== CIPHERSUITE) return false;
    return r.vector().length === 32 && !r.done();
  } catch {
    return false;
  }
}
