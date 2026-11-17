// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { sweep } from "../src/services/sweeper.js";
import { type Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();
const DAY = 86_400_000;

async function setup(profile: "child" | "self" = "child") {
  const mum = await signIn(h, "mum@example.org");
  await mum.post("/api/notifications/subscriptions", {
    platform: "web",
    endpoint: "https://fcm.googleapis.com/fcm/send/mum",
    keys: { p256dh: "B".repeat(87), auth: "A".repeat(22) },
  });
  const { phoneId, device } = await pairPhone(h, mum, { name: "Alma", profile });
  await device.put("/api/device/apps", {
    apps: [
      { packageName: "com.android.dialer", label: "Phone", core: true },
      { packageName: "com.instagram.android", label: "Instagram" },
      { packageName: "com.example.game", label: "Game" },
    ],
  });
  return { mum, phoneId, device };
}

const allowed = async (device: Client) => (await device.get("/api/device/rules")).json.apps.allowed as string[];

describe("requests from the phone", () => {
  it("asks for an app; the parent gets a push and approves; the phone sees it", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.instagram.android" });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ kind: "app", packageName: "com.instagram.android", status: "pending" });
    // Asking twice gives the same request and no second push.
    const again = await device.post("/api/device/requests", { kind: "app", packageName: "com.instagram.android" });
    expect(again.status).toBe(200);
    expect(again.json.id).toBe(r.json.id);
    expect(h.parentPush.sent.map((s) => s.msg)).toEqual([
      expect.objectContaining({ title: "Alma asks for an app", body: "Instagram. Open the app to approve or decline.", url: `/phones/${phoneId}` }),
    ]);

    const list = await mum.get(`/api/phones/${phoneId}/requests`);
    expect(list.json.requests).toEqual([expect.objectContaining({ id: r.json.id, appLabel: "Instagram", phoneId })]);
    expect((await mum.get(`/api/phones/${phoneId}`)).json.openRequests).toBe(1);

    const ok = await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/approve`, {});
    expect(ok.status).toBe(200);
    expect(ok.json.status).toBe("applied");
    expect(await allowed(device)).toContain("com.instagram.android");
    expect((await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/approve`, {})).status).toBe(409);
    const mine = await device.get("/api/device/requests");
    expect(mine.json.requests).toEqual([expect.objectContaining({ id: r.json.id, status: "approved", waitingForKey: false })]);
    expect((await mum.get(`/api/phones/${phoneId}`)).json.openRequests).toBe(0);
  });

  it("asks for a contact; the parent can fix the name, or decline", async () => {
    const { mum, phoneId, device } = await setup();
    const a = await device.post("/api/device/requests", { kind: "contact", name: "Gran", number: "+45 12 34 56 78" });
    expect(a.json).toMatchObject({ kind: "contact", name: "Gran", number: "+4512345678" });
    expect(h.parentPush.sent[0]!.msg.body).toContain("Gran (+4512345678)");
    await mum.post(`/api/phones/${phoneId}/requests/${a.json.id}/approve`, { name: "Granny" });
    expect((await device.get("/api/device/rules")).json.contacts).toEqual([{ name: "Granny", number: "+4512345678" }]);
    // Already a contact.
    expect((await device.post("/api/device/requests", { kind: "contact", name: "x", number: "+4512345678" })).status).toBe(409);

    const b = await device.post("/api/device/requests", { kind: "contact", name: "Stranger", number: "+4587654321" });
    expect((await mum.post(`/api/phones/${phoneId}/requests/${b.json.id}/reject`, {})).status).toBe(204);
    expect((await device.get("/api/device/rules")).json.contacts).toHaveLength(1);
    const mine = (await device.get("/api/device/requests")).json.requests;
    expect(mine.find((x: { id: string }) => x.id === b.json.id).status).toBe("rejected");
  });

  it("refuses apps that are not on the list or already allowed, and floods", async () => {
    const { device } = await setup();
    expect((await device.post("/api/device/requests", { kind: "app", packageName: "com.not.there" })).status).toBe(404);
    expect((await device.post("/api/device/requests", { kind: "app", packageName: "com.android.dialer" })).status).toBe(409);
    for (let i = 0; i < 10; i++) {
      const r = await device.post("/api/device/requests", { kind: "contact", name: `N${i}`, number: `+451000000${i}` });
      expect(r.status).toBe(201);
    }
    expect((await device.post("/api/device/requests", { kind: "contact", name: "N", number: "+4520000000" })).status).toBe(429);
  });

  it("on a Self phone, approving goes through the key", async () => {
    const { mum, phoneId, device } = await setup("self");
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    const ok = await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/approve`, {});
    expect(ok.status).toBe(202);
    expect(ok.json.status).toBe("pending");
    expect(await allowed(device)).not.toContain("com.example.game");
    const mine = (await device.get("/api/device/requests")).json.requests;
    expect(mine[0]).toMatchObject({ status: "approved", waitingForKey: true });
    expect(mine[0].effectiveAt).not.toBeNull();
    h.clock.advance(DAY);
    await sweep(h.ctx);
    expect(await allowed(device)).toContain("com.example.game");
    expect((await device.get("/api/device/requests")).json.requests[0].waitingForKey).toBe(false);
  });

  it("another household cannot see or answer the requests", async () => {
    const { phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    const other = await signIn(h, "other@example.org");
    expect((await other.get(`/api/phones/${phoneId}/requests`)).status).toBe(404);
    expect((await other.post(`/api/phones/${phoneId}/requests/${r.json.id}/approve`, {})).status).toBe(404);
  });

  it("deletes answered requests after 30 days", async () => {
    const { mum, phoneId, device } = await setup();
    const r = await device.post("/api/device/requests", { kind: "app", packageName: "com.example.game" });
    const open = await device.post("/api/device/requests", { kind: "app", packageName: "com.instagram.android" });
    await mum.post(`/api/phones/${phoneId}/requests/${r.json.id}/reject`, {});
    h.clock.advance(30 * DAY + 1000);
    const s = await sweep(h.ctx);
    expect(s.deleted.requests).toBe(1);
    expect((await device.get("/api/device/requests")).json.requests.map((x: { id: string }) => x.id)).toEqual([open.json.id]);
  });
});
