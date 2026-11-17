// SPDX-License-Identifier: Apache-2.0
//
// Web Push without dependencies: message encryption (RFC 8291, aes128gcm, RFC 8188) and
// VAPID authentication (RFC 8292). Node's crypto does all the work.

import {
  createCipheriv,
  createECDH,
  createHmac,
  createPrivateKey,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";

const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");
const unb64u = (s: string) => Buffer.from(s, "base64url");

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/** HKDF-Expand for one block (all lengths here are ≤ 32 bytes). */
function expand(prk: Buffer, info: Buffer, len: number): Buffer {
  return hmac(prk, Buffer.concat([info, Buffer.from([1])])).subarray(0, len);
}

export interface VapidKeys {
  /** Uncompressed P-256 point, 65 bytes, base64url. Given to browsers as applicationServerKey. */
  publicKey: string;
  /** The private scalar, 32 bytes, base64url. */
  privateKey: string;
}

/** Makes a new VAPID key pair (`node dist/lib/webpush.js` prints one). */
export function generateVapidKeys(): VapidKeys {
  const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), unb64u(jwk.x!), unb64u(jwk.y!)]);
  return { publicKey: b64u(pub), privateKey: jwk.d! };
}

/** Checks that a pair is well formed and belongs together. */
export function validVapidKeys(k: VapidKeys): boolean {
  try {
    const pub = unb64u(k.publicKey);
    if (pub.length !== 65 || pub[0] !== 4 || unb64u(k.privateKey).length !== 32) return false;
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(unb64u(k.privateKey));
    return ecdh.getPublicKey().equals(pub);
  } catch {
    return false;
  }
}

/** The `Authorization` header for a push service (VAPID, RFC 8292). Valid for 12 hours. */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now = new Date()): string {
  const pub = unb64u(keys.publicKey);
  const key = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: keys.privateKey,
      x: b64u(pub.subarray(1, 33)),
      y: b64u(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64u(
    Buffer.from(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
        sub: subject,
      }),
    ),
  );
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

export interface WebPushTarget {
  endpoint: string;
  /** The browser's P-256 public key (base64url, 65 bytes). */
  p256dh: string;
  /** The browser's auth secret (base64url, 16 bytes). */
  auth: string;
}

/**
 * Encrypts a message for one subscription (RFC 8291) as a single aes128gcm record.
 * `salt` and `senderPrivateKey` are only passed in tests.
 */
export function encryptPayload(
  target: Pick<WebPushTarget, "p256dh" | "auth">,
  plaintext: Buffer,
  opts: { salt?: Buffer; senderPrivateKey?: Buffer } = {},
): Buffer {
  const uaPublic = unb64u(target.p256dh);
  const authSecret = unb64u(target.auth);
  if (uaPublic.length !== 65 || authSecret.length < 16) throw new Error("invalid subscription keys");
  // 4096-byte records; one record fits a push message (the services cap it near 4 KB).
  if (plaintext.length > 3800) throw new Error("push message too long");

  const ecdh = createECDH("prime256v1");
  if (opts.senderPrivateKey) ecdh.setPrivateKey(opts.senderPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = expand(prkKey, keyInfo, 32);

  const salt = opts.salt ?? randomBytes(16);
  const prk = hmac(salt, ikm);
  const cek = expand(prk, Buffer.from("Content-Encoding: aes128gcm\0"), 16);
  const nonce = expand(prk, Buffer.from("Content-Encoding: nonce\0"), 12);

  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // 0x02 marks the last (and only) record.
  const body = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

export type PushOutcome = "sent" | "gone" | "failed";

/** Sends one encrypted message. "gone" means the subscription no longer exists (404/410). */
export async function sendWebPush(
  target: WebPushTarget,
  payload: unknown,
  keys: VapidKeys,
  subject: string,
  opts: { ttlSeconds?: number; urgency?: "normal" | "high"; topic?: string } = {},
): Promise<{ outcome: PushOutcome; status: number }> {
  const body = encryptPayload(target, Buffer.from(JSON.stringify(payload)));
  const res = await fetch(target.endpoint, {
    method: "POST",
    headers: {
      authorization: vapidAuthorization(target.endpoint, keys, subject),
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(opts.ttlSeconds ?? 24 * 3600),
      urgency: opts.urgency ?? "normal",
      // A newer message with the same topic replaces an undelivered older one.
      ...(opts.topic ? { topic: opts.topic } : {}),
    },
    body: new Uint8Array(body),
    signal: AbortSignal.timeout(10_000),
  });
  await res.arrayBuffer().catch(() => undefined);
  if (res.status === 404 || res.status === 410) return { outcome: "gone", status: res.status };
  return { outcome: res.ok ? "sent" : "failed", status: res.status };
}

// `node dist/lib/webpush.js` prints a fresh key pair for VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.
if (import.meta.url === `file://${process.argv[1]}`) {
  const k = generateVapidKeys();
  console.log(`VAPID_PUBLIC_KEY=${k.publicKey}\nVAPID_PRIVATE_KEY=${k.privateKey}`);
}
