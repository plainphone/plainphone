// SPDX-License-Identifier: Apache-2.0
import { createDecipheriv, createECDH, createHmac, createPublicKey, randomBytes, verify } from "node:crypto";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { encryptPayload, generateVapidKeys, sendWebPush, vapidAuthorization, validVapidKeys } from "../src/lib/webpush.js";
import { pushHostAllowed, DEFAULT_PUSH_HOSTS } from "../src/providers/parent-push.js";

const hmac = (k: Buffer, d: Buffer) => createHmac("sha256", k).update(d).digest();

/** The browser's side of RFC 8291, written out separately from the code under test. */
function browser() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = randomBytes(16);
  return {
    keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    decrypt(msg: Buffer): Buffer {
      const salt = msg.subarray(0, 16);
      const rs = msg.readUInt32BE(16);
      const idlen = msg[20]!;
      const asPublic = msg.subarray(21, 21 + idlen);
      const ct = msg.subarray(21 + idlen);
      expect(rs).toBe(4096);
      const shared = ecdh.computeSecret(asPublic);
      const prkKey = hmac(auth, shared);
      const info = Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic, Buffer.from([1])]);
      const ikm = hmac(prkKey, info);
      const prk = hmac(salt, ikm);
      const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
      const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);
      const d = createDecipheriv("aes-128-gcm", cek, nonce);
      d.setAuthTag(ct.subarray(ct.length - 16));
      const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
      expect(plain.at(-1)).toBe(2);
      return plain.subarray(0, -1);
    },
  };
}

describe("Web Push encryption (RFC 8291)", () => {
  it("encrypts so that only the subscribed browser can read it", () => {
    const b = browser();
    const msg = encryptPayload(b.keys, Buffer.from('{"title":"Hej æøå"}'));
    expect(b.decrypt(msg).toString()).toBe('{"title":"Hej æøå"}');
    // Another browser cannot.
    expect(() => browser().decrypt(Buffer.from(msg))).toThrow();
    // A fresh salt and key every time.
    expect(encryptPayload(b.keys, Buffer.from("x")).equals(encryptPayload(b.keys, Buffer.from("x")))).toBe(false);
  });

  it("refuses broken keys and too long messages", () => {
    expect(() => encryptPayload({ p256dh: "AAAA", auth: "AAAA" }, Buffer.from("x"))).toThrow();
    expect(() => encryptPayload(browser().keys, Buffer.alloc(4000))).toThrow(/too long/);
  });
});

describe("VAPID (RFC 8292)", () => {
  it("signs a JWT for the push service's origin with the private key", () => {
    const keys = generateVapidKeys();
    expect(validVapidKeys(keys)).toBe(true);
    expect(validVapidKeys({ ...keys, privateKey: generateVapidKeys().privateKey })).toBe(false);
    const now = new Date("2026-11-17T12:00:00Z");
    const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, "mailto:x@example.org", now);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header)!;
    expect(m[4]).toBe(keys.publicKey);
    const claims = JSON.parse(Buffer.from(m[2]!, "base64url").toString());
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now.getTime() / 1000 + 12 * 3600, sub: "mailto:x@example.org" });
    const pub = Buffer.from(keys.publicKey, "base64url");
    const key = createPublicKey({
      key: { kty: "EC", crv: "P-256", x: pub.subarray(1, 33).toString("base64url"), y: pub.subarray(33).toString("base64url") },
      format: "jwk",
    });
    const ok = verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3]!, "base64url"));
    expect(ok).toBe(true);
  });

  it("posts to the push service with the right headers, and reads 410 as gone", async () => {
    const b = browser();
    const seen: { headers: Record<string, unknown>; body: Buffer }[] = [];
    let status = 201;
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        seen.push({ headers: req.headers, body: Buffer.concat(chunks) });
        res.writeHead(status).end();
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const port = (server.address() as { port: number }).port;
    const endpoint = `http://127.0.0.1:${port}/push/abc`;
    const keys = generateVapidKeys();
    const r = await sendWebPush({ endpoint, ...b.keys }, { title: "t" }, keys, "mailto:x@example.org", { topic: "lock-1", urgency: "high" });
    expect(r.outcome).toBe("sent");
    expect(seen[0]!.headers).toMatchObject({ "content-encoding": "aes128gcm", ttl: "86400", urgency: "high", topic: "lock-1" });
    expect(String(seen[0]!.headers.authorization)).toMatch(/^vapid t=/);
    expect(JSON.parse(b.decrypt(seen[0]!.body).toString())).toEqual({ title: "t" });
    status = 410;
    expect((await sendWebPush({ endpoint, ...b.keys }, {}, keys, "mailto:x@example.org")).outcome).toBe("gone");
    status = 500;
    expect((await sendWebPush({ endpoint, ...b.keys }, {}, keys, "mailto:x@example.org")).outcome).toBe("failed");
    server.close();
  });
});

describe("push service allow list", () => {
  it("accepts the browsers' push services and nothing else", () => {
    const ok = (u: string) => pushHostAllowed(u, DEFAULT_PUSH_HOSTS);
    expect(ok("https://fcm.googleapis.com/fcm/send/x")).toBe(true);
    expect(ok("https://updates.push.services.mozilla.com/wpush/v2/x")).toBe(true);
    expect(ok("https://web.push.apple.com/QK/x")).toBe(true);
    expect(ok("https://db5p.notify.windows.com/w/?token=x")).toBe(true);
    expect(ok("http://fcm.googleapis.com/x")).toBe(false);
    expect(ok("https://fcm.googleapis.com:8443/x")).toBe(false);
    expect(ok("https://evil.example/fcm.googleapis.com")).toBe(false);
    expect(ok("https://fcm.googleapis.com.evil.example/x")).toBe(false);
    expect(ok("https://push.services.mozilla.com.evil/x")).toBe(false);
    expect(ok("https://10.0.0.1/x")).toBe(false);
    expect(ok("https://user@fcm.googleapis.com/x")).toBe(false);
  });
});
