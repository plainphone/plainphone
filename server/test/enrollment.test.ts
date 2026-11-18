// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { enrollments } from "../src/db/schema.js";
import { loadConfig } from "../src/config.js";
import { downloadRoutes, newestApk } from "../src/routes/download.js";
import { Client, PUBLIC_URL, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const INSTALL = "install-id-0123456789abcdef";

async function addPhone(parent: Client, profile: "child" | "self" = "child") {
  const r = await parent.post("/api/phones/enroll", { name: "Alma", profile, timezone: "Europe/Copenhagen" });
  expect(r.status).toBe(201);
  return r.json as {
    phone: { id: string; pairedAt: string | null; mode: string; dnsHost: string };
    enrollment: { token: string; expiresAt: string };
    provisioning: Record<string, string>;
  };
}

async function enroll(token: string, installId = INSTALL) {
  return new Client(h).post("/api/device/enroll", { token, installId, deviceInfo: { model: "Test" } });
}

describe("setup from the dashboard (enrollment)", () => {
  it("creates a phone waiting for setup and everything the QR code needs", async () => {
    const parent = await signIn(h, "p@example.org");
    const out = await addPhone(parent);
    expect(out.phone.pairedAt).toBeNull();
    expect(out.phone.mode).toBe("strong");
    expect(out.enrollment.token).toMatch(/^pp_e_[A-Za-z0-9_-]{22}$/);
    expect(Date.parse(out.enrollment.expiresAt) - h.clock.now.getTime()).toBe(24 * 3_600_000);
    expect(out.provisioning).toEqual({
      adminComponent: "org.plainphone.app/.PlainphoneAdminReceiver",
      downloadUrl: `${PUBLIC_URL}/download/android`,
      signatureChecksum: "iGj8FnevSjpvbT6FjOJt-bbsEQc1nbs8I4MbDOBUEhU",
      serverUrl: PUBLIC_URL,
      dnsHost: "family.adguard-dns.com",
    });
    // Only a hash is stored.
    const rows = await h.ctx.db.select().from(enrollments);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tokenHash).not.toContain(out.enrollment.token);
    // The DNS ClientID is registered at once, so the filter is ready when the phone arrives.
    expect(h.dns.clients.size).toBe(1);
    // No device token yet: the rules API refuses everything.
    expect((await new Client(h).get("/api/device/rules")).status).toBe(401);
  });

  it("pairs the phone with its token, once, and the phone then gets its rules", async () => {
    const parent = await signIn(h, "p@example.org");
    const { phone, enrollment } = await addPhone(parent);
    const r = await enroll(enrollment.token);
    expect(r.json.account).toEqual({
      maskedEmail: "p***@example.org",
      householdName: (await parent.get("/api/me")).json.households[0].name,
    });
    expect(r.status).toBe(200);
    expect(r.json.phoneId).toBe(phone.id);
    expect(r.json.deviceToken).toMatch(/^pp_d_/);

    const device = new Client(h);
    device.token = r.json.deviceToken;
    const rules = await device.get("/api/device/rules");
    expect(rules.status).toBe(200);
    expect(rules.json.phoneId).toBe(phone.id);
    const summary = await parent.get(`/api/phones/${phone.id}`);
    expect(summary.json.pairedAt).not.toBeNull();

    // Another phone with the same QR code gets nothing.
    expect((await enroll(enrollment.token, "another-install-id-000000")).status).toBe(410);
    // A new QR code for a phone that is set up is refused.
    expect((await parent.post(`/api/phones/${phone.id}/enrollment`)).status).toBe(409);
  });

  it("rejects an invalid enrollment mode without creating a phone", async () => {
    const parent = await signIn(h, "p@example.org");
    const out = await parent.post("/api/phones/enroll", { name: "Test phone", profile: "child", mode: "invalid" });
    expect(out.status).toBe(400);
    expect(await h.ctx.db.select().from(enrollments)).toHaveLength(0);
  });

  it("keeps light mode when an existing phone redeems its setup link", async () => {
    const parent = await signIn(h, "p@example.org");
    const out = await parent.post("/api/phones/enroll", { name: "Test phone", profile: "child", mode: "light" });
    expect(out.status).toBe(201);
    expect(out.json.phone.mode).toBe("light");
    const { phone, enrollment } = out.json;
    const result = await enroll(enrollment.token);
    expect(result.status).toBe(200);
    expect(result.json.phoneId).toBe(phone.id);
    expect((await parent.get(`/api/phones/${phone.id}`)).json.mode).toBe("light");
    expect((await enroll(enrollment.token, "another-install-id-000000")).status).toBe(410);
  });

  it("lets the same phone ask again when the answer was lost, and the first token stops working", async () => {
    const parent = await signIn(h, "p@example.org");
    const { enrollment } = await addPhone(parent);
    const first = await enroll(enrollment.token);
    const again = await enroll(enrollment.token);
    expect(again.status).toBe(200);
    expect(again.json.deviceToken).not.toBe(first.json.deviceToken);
    const old = new Client(h);
    old.token = first.json.deviceToken;
    expect((await old.get("/api/device/rules")).status).toBe(401);
    // Only for an hour.
    h.clock.advance(61 * 60_000);
    expect((await enroll(enrollment.token)).status).toBe(410);
  });

  it("refuses unknown, malformed and expired tokens", async () => {
    const parent = await signIn(h, "p@example.org");
    const { enrollment } = await addPhone(parent);
    expect((await enroll("pp_e_AAAAAAAAAAAAAAAAAAAAAA")).status).toBe(404);
    expect((await enroll("not-a-token")).status).toBe(400);
    expect((await enroll(enrollment.token, "short")).status).toBe(400);
    h.clock.advance(24 * 3_600_000 + 1);
    expect((await enroll(enrollment.token)).status).toBe(410);
  });

  it("makes a new QR code that replaces the old one", async () => {
    const parent = await signIn(h, "p@example.org");
    const { phone, enrollment } = await addPhone(parent);
    const fresh = await parent.post(`/api/phones/${phone.id}/enrollment`);
    expect(fresh.status).toBe(201);
    expect(fresh.json.provisioning.downloadUrl).toBe(`${PUBLIC_URL}/download/android`);
    expect((await enroll(enrollment.token)).status).toBe(404);
    expect((await enroll(fresh.json.enrollment.token)).status).toBe(200);
  });

  it("keeps other households out", async () => {
    const parent = await signIn(h, "p@example.org");
    const other = await signIn(h, "o@example.org");
    const { phone } = await addPhone(parent);
    expect((await other.post(`/api/phones/${phone.id}/enrollment`)).status).toBe(404);
    expect((await other.post("/api/phones/enroll", { name: "X", profile: "child", householdId: phone.id })).status).toBe(404);
  });

  it("gives a phone entry to exactly one of two phones that redeem at the same time", async () => {
    const parent = await signIn(h, "p@example.org");
    const { enrollment } = await addPhone(parent);
    const results = await Promise.all([
      enroll(enrollment.token, "first-install-id-000000000"),
      enroll(enrollment.token, "second-install-id-00000000"),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 410]);
  });

  it("refuses a setup QR code for a phone that is already paired with a code", async () => {
    const parent = await signIn(h, "p@example.org");
    const { phoneId } = await pairPhone(h, parent);
    expect((await parent.post(`/api/phones/${phoneId}/enrollment`)).status).toBe(409);
  });

  it("removes a Self phone that was never set up at once, without the key", async () => {
    const parent = await signIn(h, "p@example.org");
    const { phone } = await addPhone(parent, "self");
    const r = await parent.del(`/api/phones/${phone.id}`);
    expect(r.status).toBe(200);
    expect(r.json.status).toBe("applied");
    expect((await parent.get(`/api/phones/${phone.id}`)).status).toBe(404);
  });

  it("still waits for the key when a Self phone that is set up is removed", async () => {
    const parent = await signIn(h, "p@example.org");
    const { phone, enrollment } = await addPhone(parent, "self");
    expect((await enroll(enrollment.token)).status).toBe(200);
    const r = await parent.del(`/api/phones/${phone.id}`);
    expect(r.status).toBe(202);
  });
});

describe("stable APK address", () => {
  const releases = [
    { draft: false, published_at: "2026-11-16T10:00:00Z", assets: [{ name: "plainphone-0.1.2-phase4.apk", browser_download_url: "https://github.com/x/old.apk" }] },
    { draft: true, published_at: "2026-11-18T10:00:00Z", assets: [{ name: "plainphone-9.apk", browser_download_url: "https://github.com/x/draft.apk" }] },
    { draft: false, published_at: "2026-11-17T10:00:00Z", assets: [{ name: "provisioning.json", browser_download_url: "https://github.com/x/j" }, { name: "plainphone-0.1.3-android10.apk", browser_download_url: "https://github.com/x/new.apk" }] },
    { draft: false, published_at: "2026-11-17T12:00:00Z", assets: [] },
  ];

  it("picks the newest published release with an APK, pre-releases included", () => {
    expect(newestApk(releases)).toBe("https://github.com/x/new.apk");
    expect(newestApk([])).toBeNull();
  });

  it("redirects to it, caches the answer and keeps it when GitHub is down", async () => {
    let calls = 0;
    let up = true;
    const fake = (async () => {
      calls++;
      if (!up) throw new Error("offline");
      return new Response(JSON.stringify(releases), { status: 200 });
    }) as unknown as typeof fetch;
    const app = downloadRoutes(h.ctx, fake);
    const r = await app.request("/android");
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("https://github.com/x/new.apk");
    expect((await app.request("/android", { method: "HEAD" })).status).toBe(302);
    expect(calls).toBe(1);
    up = false;
    expect((await app.request("/android")).headers.get("location")).toBe("https://github.com/x/new.apk");
  });

  it("waits a minute before asking GitHub again after a failure", async () => {
    let calls = 0;
    const fake = (async () => {
      calls++;
      return new Response("rate limited", { status: 403 });
    }) as unknown as typeof fetch;
    const app = downloadRoutes(h.ctx, fake);
    expect((await app.request("/android")).status).toBe(503);
    expect((await app.request("/android")).status).toBe(503);
    expect(calls).toBe(1);
  });

  it("answers 503 when no release is known", async () => {
    const fake = (async () => new Response("[]", { status: 200 })) as unknown as typeof fetch;
    expect((await downloadRoutes(h.ctx, fake).request("/android")).status).toBe(503);
  });

  it("reads and caches metadata from the same release as the chosen APK", async () => {
    const sha256 = "a".repeat(64);
    const url = "https://github.com/x/new.apk";
    const metadata = { versionCode: 7, versionName: "0.1.6", sha256 };
    const candidates = structuredClone(releases);
    candidates[2]!.assets!.push({
      name: "plainphone-0.1.3-android10.apk.json",
      browser_download_url: "https://github.com/x/latest.json",
    });
    const calls: string[] = [];
    const fake = (async (input: string) => {
      calls.push(input);
      return Response.json(input.startsWith("https://api.github.com/") ? candidates : metadata);
    }) as typeof fetch;
    const app = downloadRoutes(h.ctx, fake);
    for (let i = 0; i < 2; i++) {
      expect(await (await app.request("/android/latest.json")).json()).toEqual({ ...metadata, url });
    }
    expect(calls).toHaveLength(2);
    expect((await app.request("/android")).headers.get("location")).toBe(url);
  });

  it("binds self-hosted metadata to APK_DOWNLOAD_URL", async () => {
    const url = "https://pp.example.org/app.apk";
    const ctx = { ...h.ctx, cfg: { ...h.ctx.cfg, APK_DOWNLOAD_URL: url, APK_METADATA_URL: url + ".json" } };
    const sha256 = "b".repeat(64);
    const fake = (async (input: string) => {
      expect(input).toBe(ctx.cfg.APK_METADATA_URL);
      return Response.json({ versionCode: 8, versionName: "0.1.7", sha256, url: "https://example.org/other.apk" });
    }) as typeof fetch;
    expect(await (await downloadRoutes(ctx, fake).request("/android/latest.json")).json())
      .toEqual({ url, versionCode: 8, versionName: "0.1.7", sha256 });
  });

  it("uses a self-hoster's fixed URL without asking GitHub", async () => {
    const ctx = { ...h.ctx, cfg: { ...h.ctx.cfg, APK_DOWNLOAD_URL: "https://pp.example.org/app.apk" } };
    const fake = (async () => {
      throw new Error("must not be called");
    }) as unknown as typeof fetch;
    const r = await downloadRoutes(ctx, fake).request("/android");
    expect(r.headers.get("location")).toBe("https://pp.example.org/app.apk");
  });
});

describe("setup configuration", () => {
  it("treats empty variables from compose files as unset", () => {
    const cfg = loadConfig({
      DATABASE_URL: "x",
      APK_DOWNLOAD_URL: "",
      APK_SIGNATURE_CHECKSUM: "",
      PROVISIONING_DNS_HOST: "",
      APK_RELEASES_REPO: "",
    });
    expect(cfg.APK_DOWNLOAD_URL).toBeUndefined();
    expect(cfg.APK_SIGNATURE_CHECKSUM).toBe("iGj8FnevSjpvbT6FjOJt-bbsEQc1nbs8I4MbDOBUEhU");
    expect(cfg.PROVISIONING_DNS_HOST).toBe("family.adguard-dns.com");
    expect(cfg.APK_RELEASES_REPO).toBe("plainphone/plainphone");
    expect(() => loadConfig({ DATABASE_URL: "x", APK_SIGNATURE_CHECKSUM: "too-short" })).toThrow();
  });
});
