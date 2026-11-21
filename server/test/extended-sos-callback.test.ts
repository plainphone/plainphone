// SPDX-License-Identifier: Apache-2.0
// SOS, callback requests and extended family side by side: SOS and "ask a parent to call" are for
// caregivers only. An extended contact never receives either (docs/extended-family.md). Synthetic data.
import { randomUUID } from "node:crypto";
import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { callbackRequests, extendedMessages, locationSnapshots, pushSubscriptions } from "../src/db/schema.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

const tokenOf = (link: string) => decodeURIComponent(/#invite=(.+)$/.exec(link)![1]!);

async function setup() {
  const parent = await signIn(h, "parent@example.org");
  const paired = await pairPhone(h, parent, { name: "Sam" });
  const { user } = (await parent.get("/api/me")).json;
  await h.ctx.db.insert(pushSubscriptions).values({ userId: user.id, platform: "web", endpoint: "https://example.test/p" });
  const sos = `/api/phones/${paired.phoneId}/sos`;
  const on = await parent.put(sos, {
    familyInbox: true, extendedFamily: true, quickMessagesEnabled: true,
    callbackNumber: "+4500000001", callbackConfirmed: true, callbackRequests: true,
  });
  expect(on.status).toBe(204);
  const invited = await parent.post(`/api/phones/${paired.phoneId}/extended`, { name: "Grandma" });
  expect(invited.status).toBe(201);
  expect((await paired.device.post(`/api/device/extended/${invited.json.contact.id}/answer`, { allow: true })).status).toBe(204);
  const contact = new Client(h);
  const accepted = await contact.post("/api/family-contact/accept", { token: tokenOf(invited.json.link) });
  expect(accepted.status).toBe(200);
  contact.token = accepted.json.session;
  return { parent, ...paired, contact, contactId: invited.json.contact.id as string };
}

describe("extended family next to SOS and callback requests", () => {
  it("keeps both switches working while an extended contact is on the roster", async () => {
    const s = await setup();
    const rules = (await s.device.get("/api/device/rules")).json;
    expect(rules.sos.callback).toEqual({ enabled: true });
    expect(rules.extended.contacts).toHaveLength(1);
  });

  // Weak by itself: an extended contact has no push channel, so these checks would also pass if the
  // code tried to notify them. The real guards are the 401 test below and `sos.parents` being built
  // only from contacts with `sosParent`.
  it("never sends an SOS or a callback request to an extended contact", async () => {
    const s = await setup();
    h.parentPush.sent.length = 0;
    const location = { lat: 55.6, lon: 12.5 };
    expect((await s.device.post("/api/device/sos", { id: randomUUID(), kind: "urgent", location })).status).toBe(200);
    expect((await s.device.post("/api/device/callback-requests", { id: randomUUID() })).status).toBeLessThan(300);

    // The parents are told, both times.
    const types = h.parentPush.sent.map((p) => (p.msg.data as { type?: string }).type);
    expect(types).toContain("sos-urgent");
    expect(types).toContain("callback-request");
    // The extended contact has no message, no shared position and no way to read either report.
    const [row] = await h.ctx.db.select({ total: count() }).from(extendedMessages).where(eq(extendedMessages.contactId, s.contactId));
    expect(row?.total).toBe(0);
    expect(await h.ctx.db.select().from(locationSnapshots)).toHaveLength(0);
    expect(await h.ctx.db.select().from(callbackRequests)).toHaveLength(1);
    const page = (await s.contact.get("/api/family-contact/me")).json;
    expect(page.messages).toEqual([]);
    expect(JSON.stringify(page)).not.toMatch(/sos|callback|55\.6/i);
  });

  it("refuses the contact's session on every SOS and callback route", async () => {
    const s = await setup();
    const eventId = randomUUID();
    expect((await s.device.post("/api/device/sos", { id: eventId, kind: "urgent" })).status).toBe(200);
    const routes: Array<[string, () => Promise<{ status: number }>]> = [
      ["device sos", () => s.contact.post("/api/device/sos", { id: randomUUID(), kind: "urgent" })],
      ["device callback", () => s.contact.post("/api/device/callback-requests", { id: randomUUID() })],
      ["parent sos list", () => s.contact.get(`/api/phones/${s.phoneId}/sos`)],
      ["parent sos seen", () => s.contact.post(`/api/phones/${s.phoneId}/sos/${eventId}/seen`, {})],
      ["parent callback list", () => s.contact.get(`/api/phones/${s.phoneId}/callback-requests`)],
    ];
    for (const [name, call] of routes) expect([name, (await call()).status]).toEqual([name, 401]);
  });
});
