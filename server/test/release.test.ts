// SPDX-License-Identifier: Apache-2.0
//
// "Release the phone": the parents switch Plainphone off on the phone from the dashboard.

import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { dnsDeletions, phones } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const rules = async (device: Client) => (await device.get("/api/device/rules")).json;

async function setup(profile: "child" | "self") {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile });
  return { parent, phoneId, device };
}

describe("release on a Child phone", () => {
  it("applies at once and tells the phone in the rules", async () => {
    const { parent, phoneId, device } = await setup("child");
    const before = await device.get("/api/device/rules");
    expect(before.json.release).toBe(false);
    const etag = before.headers.get("etag")!;
    expect((await device.get("/api/device/rules", { "if-none-match": etag })).status).toBe(304);
    const listed = await parent.get("/api/phones");
    expect(listed.json.phones[0].releaseRequestedAt).toBeNull();

    const r = await parent.post(`/api/phones/${phoneId}/release`);
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ status: "applied" });

    const released = await device.get("/api/device/rules", { "if-none-match": etag });
    expect(released.status).toBe(200);
    expect(released.json.release).toBe(true);
    expect(released.headers.get("etag")).not.toBe(etag);
    const after = await parent.get("/api/phones");
    expect(after.json.phones).toHaveLength(1);
    expect(after.json.phones[0].releaseRequestedAt).toBe(h.clock.now.toISOString());
  });

  it("counts three release rule fetches, including cached rules and concurrent fetches", async () => {
    const { parent, phoneId, device } = await setup("child");
    const detail = `/api/phones/${phoneId}`;
    await device.get("/api/device/rules");
    expect((await parent.get(detail)).json.releaseSyncCount).toBe(0);
    await parent.post(`${detail}/release`);

    const first = await device.get("/api/device/rules");
    expect(first.json.release).toBe(true);
    expect((await parent.get(detail)).json.releaseSyncCount).toBe(1);

    const headers = { "if-none-match": first.headers.get("etag")! };
    const responses = await Promise.all([device.get("/api/device/rules", headers), device.get("/api/device/rules", headers)]);
    expect(responses.map((r) => r.status)).toEqual([304, 304]);
    await device.get("/api/device/rules", headers);
    expect((await parent.get(detail)).json.releaseSyncCount).toBe(3);
  });

  it("syncs support settings without cancelling a pending release", async () => {
    const { parent, phoneId, device } = await setup("child");
    const detail = `/api/phones/${phoneId}`;
    expect((await device.get("/api/device/rules")).json.supportEnabled).toBe(true);
    await parent.post(`${detail}/release`);
    expect((await parent.patch(detail, { supportEnabled: false, releaseWarningsEnabled: false })).json)
      .toMatchObject({ supportEnabled: false, releaseWarningsEnabled: false });
    expect((await device.get("/api/device/rules")).json).toMatchObject({
      supportEnabled: false, releaseWarningsEnabled: false, release: true,
    });
    expect((await parent.get(detail)).json.releaseSyncCount).toBe(0);
    expect((await device.post("/api/device/released")).status).toBe(204);
  });

  it("wakes the phone, so it does not wait for the next poll", async () => {
    const { parent, phoneId, device } = await setup("child");
    await device.put("/api/device/push-token", { fcmToken: "fcm-token-1" });
    await parent.post(`/api/phones/${phoneId}/release`);
    expect(h.push.sent).toContainEqual({ token: "fcm-token-1", reason: "rules" });
  });

  it("keeps the phone until the phone says it has switched Plainphone off", async () => {
    const { parent, phoneId, device } = await setup("child");
    await parent.post(`/api/phones/${phoneId}/release`);
    expect(h.dns.clients.size).toBe(1);
    expect((await device.get("/api/device/rules")).status).toBe(200);
    expect((await parent.get("/api/phones")).json.phones).toHaveLength(1);
  });
});

describe("release on a Self phone", () => {
  it("waits for the key, and the rules do not change until it is applied", async () => {
    const { parent, phoneId, device } = await setup("self");
    const r = await parent.post(`/api/phones/${phoneId}/release`);
    expect(r.status).toBe(202);
    expect(r.json.status).toBe("pending");
    expect(r.json.change.op).toEqual({ type: "phone.release" });

    const doc = await rules(device);
    expect(doc.release).toBe(false);
    // The phone shows the countdown like for any other change.
    expect(doc.pendingChanges).toHaveLength(1);
    expect(doc.pendingChanges[0].op.type).toBe("phone.release");
    expect((await parent.get("/api/phones")).json.phones[0].releaseRequestedAt).toBeNull();
    // Nothing to acknowledge yet.
    expect((await device.post("/api/device/released")).status).toBe(409);

    h.clock.advance(24 * 3_600_000);
    const applied = await rules(device);
    expect(applied.release).toBe(true);
    expect(applied.pendingChanges).toHaveLength(0);
    expect((await device.post("/api/device/released")).status).toBe(204);
  });

  it("can be cancelled while it waits", async () => {
    const { parent, phoneId, device } = await setup("self");
    const r = await parent.post(`/api/phones/${phoneId}/release`);
    const cancelled = await parent.post(`/api/changes/${r.json.change.id}/cancel`);
    expect(cancelled.status).toBeLessThan(300);
    h.clock.advance(48 * 3_600_000);
    expect((await rules(device)).release).toBe(false);
  });
});

describe("release of a phone that never paired", () => {
  it("is refused: remove the phone instead", async () => {
    const parent = await signIn(h, "parent@example.org");
    const made = await parent.post("/api/phones/enroll", { name: "Alma", profile: "self", timezone: "Europe/Copenhagen" });
    expect(made.status).toBe(201);
    const r = await parent.post(`/api/phones/${made.json.phone.id}/release`);
    expect(r.status).toBe(400);
    expect(r.json.error).toMatch(/remove it instead/);
  });

  it("is refused on a Child phone too", async () => {
    const parent = await signIn(h, "parent@example.org");
    const made = await parent.post("/api/phones/enroll", { name: "Alma", profile: "child", timezone: "Europe/Copenhagen" });
    const r = await parent.post(`/api/phones/${made.json.phone.id}/release`);
    expect(r.status).toBe(400);
  });
});

describe("another household", () => {
  it("cannot release the phone", async () => {
    const { phoneId } = await setup("child");
    const other = await signIn(h, "other@example.org");
    expect((await other.post(`/api/phones/${phoneId}/release`)).status).toBe(404);
  });

  it("needs a session", async () => {
    const { phoneId } = await setup("child");
    expect((await new Client(h).post(`/api/phones/${phoneId}/release`)).status).toBe(401);
  });
});

describe("POST /device/released", () => {
  it("is refused with 409 when nobody asked for a release", async () => {
    const { phoneId, device } = await setup("child");
    const r = await device.post("/api/device/released");
    expect(r.status).toBe(409);
    // The phone is still there, and still works.
    expect((await rules(device)).release).toBe(false);
    const [row] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
    expect(row).toBeDefined();
    expect(h.dns.clients.size).toBe(1);
  });

  it("needs the device token", async () => {
    expect((await new Client(h).post("/api/device/released")).status).toBe(401);
  });

  it("deletes the phone, forgets its DNS ClientID and makes the token unknown", async () => {
    const { parent, phoneId, device } = await setup("child");
    await parent.post(`/api/phones/${phoneId}/release`);
    const clientId = [...h.dns.clients.keys()][0]!;

    const r = await device.post("/api/device/released");
    expect(r.status).toBe(204);

    expect(await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId))).toHaveLength(0);
    expect((await parent.get("/api/phones")).json.phones).toHaveLength(0);
    // The mock DNS service answered, so the deletion is done and nothing is left to retry.
    expect(h.dns.clients.has(clientId)).toBe(false);
    expect(await h.ctx.db.select().from(dnsDeletions)).toHaveLength(0);
    // The phone reads 401 as "removed", for the rules and for a second acknowledgement.
    expect((await device.get("/api/device/rules")).status).toBe(401);
    expect((await device.post("/api/device/released")).status).toBe(401);
  });

  it("queues the DNS deletion when the DNS service is down, and the sweeper finishes it", async () => {
    const { parent, phoneId, device } = await setup("child");
    await parent.post(`/api/phones/${phoneId}/release`);
    const clientId = [...h.dns.clients.keys()][0]!;
    h.dns.failNextDelete = 1;

    expect((await device.post("/api/device/released")).status).toBe(204);
    expect((await device.get("/api/device/rules")).status).toBe(401);
    expect((await h.ctx.db.select().from(dnsDeletions)).map((r) => r.clientId)).toEqual([clientId]);

    h.clock.advance(3 * 60_000);
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(dnsDeletions)).toHaveLength(0);
    expect(h.dns.clients.has(clientId)).toBe(false);
  });
});
