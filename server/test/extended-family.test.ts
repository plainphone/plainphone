// SPDX-License-Identifier: Apache-2.0
// Extended family contacts and location snapshots (docs/extended-family.md). The harness clock is
// fixed, and every person here is synthetic.
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { extendedContacts, locationSnapshots, pushSubscriptions } from "../src/db/schema.js";
import { sweep } from "../src/services/sweeper.js";
import { Client, pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

async function setup(email = "parent@example.org", on: Record<string, boolean> = { familyInbox: true, extendedFamily: true, quickMessagesEnabled: true }) {
  const parent = await signIn(h, email);
  const paired = await pairPhone(h, parent, { name: "Sam" });
  if (Object.keys(on).length) await parent.put(`/api/phones/${paired.phoneId}/sos`, on);
  return { parent, ...paired };
}

const tokenOf = (link: string) => decodeURIComponent(/#invite=(.+)$/.exec(link)![1]!);

async function invite(parent: Client, phoneId: string, name = "Grandma") {
  const r = await parent.post(`/api/phones/${phoneId}/extended`, { name });
  expect(r.status).toBe(201);
  h.clock.advance(1); // the roster is in invitation order
  return { id: r.json.contact.id as string, token: tokenOf(r.json.link) };
}

/** The contact's browser: no parent session, only what accepting the link gave it. */
async function accept(token: string) {
  const browser = new Client(h);
  const r = await browser.post("/api/family-contact/accept", { token });
  expect(r.status).toBe(200);
  browser.token = r.json.session;
  return browser;
}

async function member(parent: Client, device: Client, phoneId: string, name = "Grandma") {
  const inv = await invite(parent, phoneId, name);
  expect((await device.post(`/api/device/extended/${inv.id}/answer`, { allow: true })).status).toBe(204);
  return { ...inv, contact: await accept(inv.token) };
}

const roster = async (device: Client) => (await device.get("/api/device/rules")).json.extended;
const status = async (parent: Client, phoneId: string) =>
  (await parent.get(`/api/phones/${phoneId}/extended`)).json.contacts.map((c: { name: string; status: string }) => [c.name, c.status]);

describe("switches", () => {
  it("are off for a new phone and keep both blocks out of the rules", async () => {
    const { parent, phoneId, device } = await setup("p@example.org", {});
    expect((await parent.get(`/api/phones/${phoneId}/sos`)).json.settings).toMatchObject({ extendedFamily: false, locationSnapshots: false });
    const rules = (await device.get("/api/device/rules")).json;
    expect(rules.extended).toBeUndefined();
    expect(rules.locationSnapshot).toBeUndefined();
    expect((await parent.post(`/api/phones/${phoneId}/extended`, { name: "Grandma" })).status).toBe(403);
  });

  it("need the family inbox", async () => {
    const { parent, phoneId, device } = await setup("p@example.org", { extendedFamily: true, locationSnapshots: true });
    let rules = (await device.get("/api/device/rules")).json;
    expect(rules.extended).toBeUndefined();
    expect(rules.locationSnapshot).toBeUndefined();
    await parent.put(`/api/phones/${phoneId}/sos`, { familyInbox: true });
    rules = (await device.get("/api/device/rules")).json;
    expect(rules.extended).toEqual({ enabled: true, quickMessages: false, contacts: [] });
    expect(rules.locationSnapshot).toEqual({ enabled: true, minutes: 60 });
  });

  it("do not exist on a Myself phone", async () => {
    const parent = await signIn(h, "adult@example.org");
    const { phoneId, device } = await pairPhone(h, parent, { profile: "self" });
    expect((await parent.put(`/api/phones/${phoneId}/sos`, { extendedFamily: true })).status).toBe(404);
    expect((await parent.get(`/api/phones/${phoneId}/extended`)).status).toBe(404);
    expect((await device.get("/api/device/rules")).json.extended).toBeUndefined();
  });
});

describe("invitations", () => {
  it("need both the child's yes and the person's acceptance, in either order", async () => {
    const { parent, phoneId, device } = await setup();
    const first = await invite(parent, phoneId, "Grandma");
    const second = await invite(parent, phoneId, "Big brother");
    expect(await roster(device)).toMatchObject({ contacts: [
      { id: first.id, name: "Grandma", status: "waitingForChild", group: "others" },
      { id: second.id, name: "Big brother", status: "waitingForChild" },
    ] });

    // Grandma accepts first, then the child says yes.
    const preview = await new Client(h).post("/api/family-contact/invite", { token: first.token });
    expect(preview.json).toMatchObject({ childName: "Sam", contactName: "Grandma", childApproved: false });
    const grandma = await accept(first.token);
    expect((await grandma.get("/api/family-contact/me")).json).toMatchObject({ status: "waitingForChild", canReply: false });
    expect((await grandma.post("/api/family-contact/me/messages", { text: "Hi" })).status).toBe(403);
    await device.post(`/api/device/extended/${first.id}/answer`, { allow: true });
    expect((await grandma.get("/api/family-contact/me")).json).toMatchObject({ status: "active", canReply: true, childName: "Sam" });

    // The child says yes first, then the brother accepts.
    await device.post(`/api/device/extended/${second.id}/answer`, { allow: true });
    expect(await status(parent, phoneId)).toEqual([["Grandma", "active"], ["Big brother", "waitingForContact"]]);
    await accept(second.token);
    expect(await status(parent, phoneId)).toEqual([["Grandma", "active"], ["Big brother", "active"]]);
  });

  it("are single-use: a replayed link finds nothing", async () => {
    const { parent, phoneId } = await setup();
    const inv = await invite(parent, phoneId);
    await accept(inv.token);
    const replay = new Client(h);
    expect((await replay.post("/api/family-contact/accept", { token: inv.token })).status).toBe(404);
    expect((await replay.post("/api/family-contact/invite", { token: inv.token })).status).toBe(404);
    expect((await replay.post("/api/family-contact/decline", { token: inv.token })).status).toBe(404);
  });

  it("can be declined by the child, which ends the link, and by the person", async () => {
    const { parent, phoneId, device } = await setup();
    const no = await invite(parent, phoneId, "Uncle");
    const declined = await invite(parent, phoneId, "Aunt");
    expect((await device.post(`/api/device/extended/${no.id}/answer`, { allow: false })).status).toBe(204);
    expect((await device.post(`/api/device/extended/${no.id}/answer`, { allow: false })).status).toBe(204);
    expect((await device.post(`/api/device/extended/${no.id}/answer`, { allow: true })).status).toBe(409);
    expect((await new Client(h).post("/api/family-contact/accept", { token: no.token })).status).toBe(404);

    expect((await new Client(h).post("/api/family-contact/decline", { token: declined.token })).status).toBe(204);
    expect(await status(parent, phoneId)).toEqual([["Uncle", "declinedByChild"], ["Aunt", "declinedByContact"]]);
    // Neither is on the child's roster any more.
    expect((await roster(device)).contacts).toEqual([]);
    // A new link for someone the child declined is refused: invite again, and the child decides again.
    expect((await parent.post(`/api/phones/${phoneId}/extended/${no.id}/link`)).status).toBe(409);
  });

  it("expire after a week", async () => {
    const { parent, phoneId, device } = await setup();
    const inv = await invite(parent, phoneId);
    h.clock.advance(7 * 86_400_000 + 1);
    expect((await new Client(h).post("/api/family-contact/accept", { token: inv.token })).status).toBe(410);
    expect(await status(parent, phoneId)).toEqual([["Grandma", "expired"]]);
    expect((await roster(device)).contacts).toEqual([]);
    // A new link revives it.
    const renewed = await parent.post(`/api/phones/${phoneId}/extended/${inv.id}/link`);
    expect(renewed.status).toBe(200);
    expect(renewed.json.contact.status).toBe("waitingForChild");
  });

  it("are limited to ten per phone", async () => {
    const { parent, phoneId } = await setup();
    for (let i = 0; i < 10; i++) await invite(parent, phoneId, `Cousin ${i}`);
    expect((await parent.post(`/api/phones/${phoneId}/extended`, { name: "One more" })).status).toBe(409);
  });
});

describe("roles", () => {
  it("give a contact no parent or device rights, and a contact session reaches only its own conversation", async () => {
    const { parent, phoneId, device } = await setup();
    const { contact, token } = await member(parent, device, phoneId);
    for (const path of ["/api/me", `/api/phones/${phoneId}`, `/api/phones/${phoneId}/extended`, `/api/phones/${phoneId}/inbox`, "/api/phones"]) {
      expect((await contact.get(path)).status, path).toBe(401);
    }
    expect((await contact.get("/api/device/rules")).status).toBe(401);
    expect((await contact.post(`/api/phones/${phoneId}/extended`, { name: "Friend" })).status).toBe(401);
    // An invitation token is not a session either.
    const asInvite = new Client(h);
    asInvite.token = token;
    expect((await asInvite.get("/api/family-contact/me")).status).toBe(401);
    // A parent session or a device token is not a contact session.
    expect((await parent.get("/api/family-contact/me")).status).toBe(401);
    expect((await device.get("/api/family-contact/me")).status).toBe(401);
    // Parents see the roster but not the conversation.
    const list = (await parent.get(`/api/phones/${phoneId}/extended`)).json;
    expect(JSON.stringify(list)).not.toContain("messages");
  });

  it("keep households apart", async () => {
    const a = await setup("a@example.org");
    const b = await setup("b@example.org");
    const inv = await invite(a.parent, a.phoneId);
    expect((await b.parent.get(`/api/phones/${a.phoneId}/extended`)).status).toBe(404);
    expect((await b.parent.del(`/api/phones/${a.phoneId}/extended/${inv.id}`)).status).toBe(404);
    expect((await b.parent.post(`/api/phones/${b.phoneId}/extended/${inv.id}/link`)).status).toBe(404);
    expect((await b.parent.del(`/api/phones/${b.phoneId}/extended/${inv.id}`)).status).toBe(404);
    // Phone B cannot answer, block, read or write phone A's contact.
    expect((await b.device.post(`/api/device/extended/${inv.id}/answer`, { allow: true })).status).toBe(404);
    expect((await b.device.post(`/api/device/extended/${inv.id}/block`)).status).toBe(404);
    expect((await b.device.get(`/api/device/extended/${inv.id}`)).status).toBe(404);
    expect((await b.device.post(`/api/device/extended/${inv.id}/messages`, { id: randomUUID(), text: "Hi" })).json)
      .toEqual({ stored: false, gone: true });
    expect(await status(a.parent, a.phoneId)).toEqual([["Grandma", "waitingForChild"]]);
  });
});

describe("conversation", () => {
  it("carries the child's quick messages and short replies, with device receipts", async () => {
    const { parent, phoneId, device } = await setup();
    const { id, contact } = await member(parent, device, phoneId);
    const rev0 = (await roster(device)).contacts[0].rev;
    const message = { id: randomUUID(), text: "Pick me up", sentAt: new Date(h.clock.now.getTime() - 60_000).toISOString() };
    expect((await device.post(`/api/device/extended/${id}/messages`, message)).json).toEqual({ stored: true });
    expect((await device.post(`/api/device/extended/${id}/messages`, message)).json).toEqual({ stored: true });

    const view = (await contact.get("/api/family-contact/me")).json;
    expect(view.messages).toEqual([
      { id: message.id, from: "child", kind: "quick", text: "Pick me up", sentAt: message.sentAt, receivedAt: null },
    ]);
    // The contact's device got it: the phone sees the receipt after its next fetch.
    const rev1 = (await roster(device)).contacts[0].rev;
    expect(rev1).toBeGreaterThan(rev0);
    expect((await device.get(`/api/device/extended/${id}`)).json.messages[0].receivedAt).toBe(h.clock.now.toISOString());

    const reply = await contact.post("/api/family-contact/me/messages", { text: "On my way" });
    expect(reply.status).toBe(201);
    expect((await roster(device)).contacts[0].rev).toBeGreaterThan(rev1);
    const thread = (await device.get(`/api/device/extended/${id}`)).json;
    expect(thread.messages.map((m: { from: string; text: string }) => [m.from, m.text])).toEqual([["child", "Pick me up"], ["contact", "On my way"]]);
    await device.post(`/api/device/extended/${id}/received`, { ids: [reply.json.id] });
    expect((await contact.get("/api/family-contact/me")).json.messages[1].receivedAt).toBe(h.clock.now.toISOString());
    // A reply is as short as a parent's.
    expect((await contact.post("/api/family-contact/me/messages", { text: "x".repeat(61) })).status).toBe(400);
  });

  it("limits replies to twenty an hour", async () => {
    const { parent, phoneId, device } = await setup();
    const { contact } = await member(parent, device, phoneId);
    for (let i = 0; i < 20; i++) expect((await contact.post("/api/family-contact/me/messages", { text: `Hi ${i}` })).status).toBe(201);
    expect((await contact.post("/api/family-contact/me/messages", { text: "Too many" })).status).toBe(429);
    h.clock.advance(3_600_001);
    expect((await contact.post("/api/family-contact/me/messages", { text: "Later" })).status).toBe(201);
  });

  it("pauses when the parents switch it off, keeping the roster, and records what the phone already sent", async () => {
    const { parent, phoneId, device } = await setup();
    const { id, contact } = await member(parent, device, phoneId);
    await parent.put(`/api/phones/${phoneId}/sos`, { extendedFamily: false });
    expect((await roster(device))).toBeUndefined();
    expect((await contact.get("/api/family-contact/me")).json).toMatchObject({ paused: true, canReply: false });
    expect((await contact.post("/api/family-contact/me/messages", { text: "Hi" })).status).toBe(403);
    // Sent before the phone heard about the switch: recorded.
    expect((await device.post(`/api/device/extended/${id}/messages`, { id: randomUUID(), text: "Late" })).json).toEqual({ stored: true });
    // Blocking still works while it is off.
    expect((await device.post(`/api/device/extended/${id}/block`)).status).toBe(204);
    await parent.put(`/api/phones/${phoneId}/sos`, { extendedFamily: true });
    expect(await status(parent, phoneId)).toEqual([["Grandma", "blocked"]]);
  });
});

describe("block, removal and new links", () => {
  it("lets the child block a person: their session ends at once and only a new invitation undoes it", async () => {
    const { parent, phoneId, device } = await setup();
    const { id, contact } = await member(parent, device, phoneId);
    expect((await device.post(`/api/device/extended/${id}/block`)).status).toBe(204);
    expect((await device.post(`/api/device/extended/${id}/block`)).status).toBe(204);
    expect((await contact.get("/api/family-contact/me")).status).toBe(401);
    expect((await contact.post("/api/family-contact/me/messages", { text: "Hi" })).status).toBe(401);
    expect((await roster(device)).contacts).toMatchObject([{ id, status: "blocked" }]);
    expect((await parent.post(`/api/phones/${phoneId}/extended/${id}/link`)).status).toBe(409);
    // The phone sending to a blocked person gets "gone", nothing is kept.
    expect((await device.post(`/api/device/extended/${id}/messages`, { id: randomUUID(), text: "Hi" })).json).toEqual({ stored: false, gone: true });
    // The parent removes them; a new invitation needs the child's yes again.
    expect((await parent.del(`/api/phones/${phoneId}/extended/${id}`)).status).toBe(204);
    const again = await invite(parent, phoneId);
    expect((await roster(device)).contacts).toMatchObject([{ id: again.id, status: "waitingForChild" }]);
  });

  it("handles a removal while the phone is offline", async () => {
    const { parent, phoneId, device } = await setup();
    const { id, contact } = await member(parent, device, phoneId);
    const queued = { id: randomUUID(), text: "Pick me up", sentAt: h.clock.now.toISOString() };
    // The phone is offline; the parent removes the person.
    h.clock.advance(10 * 60_000);
    expect((await parent.del(`/api/phones/${phoneId}/extended/${id}`)).status).toBe(204);
    expect((await contact.get("/api/family-contact/me")).status).toBe(401);
    // The phone comes back with its queued message: nobody to keep it for, and it says so.
    expect((await device.post(`/api/device/extended/${id}/messages`, queued)).json).toEqual({ stored: false, gone: true });
    expect((await device.get(`/api/device/extended/${id}`)).status).toBe(404);
    expect((await roster(device)).contacts).toEqual([]);
  });

  it("rotates a person's link: the old session stops, the history is gone and the child says yes again", async () => {
    const { parent, phoneId, device } = await setup();
    const { id, contact } = await member(parent, device, phoneId);
    await device.post(`/api/device/extended/${id}/messages`, { id: randomUUID(), text: "Before" });
    await contact.post("/api/family-contact/me/messages", { text: "Old reply" });

    // Account recovery: a parent sends a new link, for a new device or a lost link.
    const renewed = await parent.post(`/api/phones/${phoneId}/extended/${id}/link`);
    expect(renewed.status).toBe(200);
    expect((await contact.get("/api/family-contact/me")).status).toBe(401);
    expect((await roster(device)).contacts).toMatchObject([{ id, status: "waitingForChild" }]);
    const fresh = await accept(tokenOf(renewed.json.link));
    expect((await fresh.get("/api/family-contact/me")).json).toMatchObject({ status: "waitingForChild", messages: [] });
    expect((await fresh.post("/api/family-contact/me/messages", { text: "Hi" })).status).toBe(403);
    await device.post(`/api/device/extended/${id}/answer`, { allow: true });
    expect((await fresh.get("/api/family-contact/me")).json).toMatchObject({ status: "active", messages: [] });
    // The child's phone sees an empty conversation too.
    expect((await device.get(`/api/device/extended/${id}`)).json.messages).toEqual([]);
  });

  it("lets the person leave", async () => {
    const { parent, phoneId, device } = await setup();
    const { contact } = await member(parent, device, phoneId);
    expect((await contact.del("/api/family-contact/me")).status).toBe(204);
    expect((await contact.get("/api/family-contact/me")).status).toBe(401);
    expect(await status(parent, phoneId)).toEqual([]);
  });

  it("puts a person in a contact group only when the parent does", async () => {
    const { parent, phoneId, device } = await setup();
    const { id } = await member(parent, device, phoneId);
    expect((await roster(device)).contacts[0].group).toBe("others");
    expect((await parent.patch(`/api/phones/${phoneId}/extended/${id}`, { group: "family" })).json.group).toBe("family");
    expect((await roster(device)).contacts[0].group).toBe("family");
  });

  it("sweeps declined and expired invitations after a month", async () => {
    const { parent, phoneId, device } = await setup();
    const no = await invite(parent, phoneId, "Uncle");
    await invite(parent, phoneId, "Aunt");
    await member(parent, device, phoneId, "Grandma");
    await device.post(`/api/device/extended/${no.id}/answer`, { allow: false });
    h.clock.advance(38 * 86_400_000);
    await sweep(h.ctx);
    expect((await h.ctx.db.select().from(extendedContacts)).map((r) => r.name)).toEqual(["Grandma"]);
  });
});

describe("location snapshots", () => {
  const on = { familyInbox: true, extendedFamily: true, quickMessagesEnabled: true, locationSnapshots: true };
  const fix = (to: string, extra: Record<string, unknown> = {}) => ({
    id: randomUUID(), to, lat: 55.68, lon: 12.57, accuracyM: 20, recordedAt: h.clock.now.toISOString(), ...extra,
  });

  it("go to the parents only, with a push, and expire after an hour", async () => {
    const { parent, phoneId, device } = await setup("p@example.org", on);
    const { user } = (await parent.get("/api/me")).json;
    await h.ctx.db.insert(pushSubscriptions).values({ userId: user.id, platform: "web", endpoint: "https://example.test/p" });
    const { contact } = await member(parent, device, phoneId);
    const shot = fix("parents");
    const r = await device.post("/api/device/location-snapshot", shot);
    expect(r.json).toMatchObject({ stored: true, kept: true, notified: 1 });
    expect(h.parentPush.sent.at(-1)!.msg.data).toMatchObject({ type: "location-snapshot" });
    const line = (await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages.at(-1);
    expect(line).toMatchObject({ id: shot.id, kind: "snapshot", delivered: 1, location: { lat: 55.68, lon: 12.57, accuracyM: 20 } });
    // Recipient isolation: the contact sees nothing, and the parents' location page is unchanged.
    expect(JSON.stringify((await contact.get("/api/family-contact/me")).json)).not.toContain("55.68");
    expect((await parent.get(`/api/phones/${phoneId}/location`)).json.location ?? null).toBeNull();

    h.clock.advance(60 * 60_000 + 1);
    expect((await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages.at(-1)).toMatchObject({ id: shot.id, location: null });
    await sweep(h.ctx);
    expect(await h.ctx.db.select().from(locationSnapshots)).toHaveLength(0);
  });

  it("go to one contact only", async () => {
    const { parent, phoneId, device } = await setup("p@example.org", on);
    const grandma = await member(parent, device, phoneId, "Grandma");
    const brother = await member(parent, device, phoneId, "Big brother");
    const shot = fix(grandma.id);
    expect((await device.post("/api/device/location-snapshot", shot)).json).toMatchObject({ stored: true, kept: true, notified: 0 });
    expect((await grandma.contact.get("/api/family-contact/me")).json.messages.at(-1))
      .toMatchObject({ id: shot.id, kind: "snapshot", location: { lat: 55.68 } });
    expect((await brother.contact.get("/api/family-contact/me")).json.messages).toEqual([]);
    expect((await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages).toEqual([]);
    expect(h.parentPush.sent).toHaveLength(0);
  });

  it("keep only the newest, and a retry neither duplicates nor replaces a newer one", async () => {
    const { parent, phoneId, device } = await setup("p@example.org", on);
    const grandma = await member(parent, device, phoneId);
    const first = fix("parents");
    await device.post("/api/device/location-snapshot", first);
    h.clock.advance(60_000);
    const second = fix(grandma.id, { lat: 56 });
    await device.post("/api/device/location-snapshot", second);
    expect((await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages.at(-1)).toMatchObject({ id: first.id, location: null });
    // The first one again (a transport retry): recorded once, the newer position stays.
    expect((await device.post("/api/device/location-snapshot", first)).json).toMatchObject({ stored: true, kept: false });
    expect((await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages).toHaveLength(1);
    expect((await grandma.contact.get("/api/family-contact/me")).json.messages.at(-1)).toMatchObject({ location: { lat: 56 } });
  });

  it("follow the switch: off deletes the stored one, and one sent on the way is recorded without its position", async () => {
    const { parent, phoneId, device } = await setup("p@example.org", on);
    await device.post("/api/device/location-snapshot", fix("parents"));
    await parent.put(`/api/phones/${phoneId}/sos`, { locationSnapshots: false });
    expect(await h.ctx.db.select().from(locationSnapshots)).toHaveLength(0);
    expect((await device.get("/api/device/rules")).json.locationSnapshot).toBeUndefined();
    h.clock.advance(1000);
    const late = fix("parents");
    expect((await device.post("/api/device/location-snapshot", late)).json).toMatchObject({ stored: true, kept: false });
    expect((await parent.get(`/api/phones/${phoneId}/inbox`)).json.messages.at(-1)).toMatchObject({ id: late.id, location: null });
  });

  it("to a removed contact are not kept", async () => {
    const { parent, phoneId, device } = await setup("p@example.org", on);
    const { id } = await member(parent, device, phoneId);
    await parent.del(`/api/phones/${phoneId}/extended/${id}`);
    expect((await device.post("/api/device/location-snapshot", fix(id))).json).toEqual({ stored: false, kept: false, gone: true });
    expect(await h.ctx.db.select().from(locationSnapshots)).toHaveLength(0);
  });

  it("go with the contact when the child blocks them", async () => {
    const { parent, phoneId, device } = await setup("p@example.org", on);
    const { id } = await member(parent, device, phoneId);
    await device.post("/api/device/location-snapshot", fix(id));
    await device.post(`/api/device/extended/${id}/block`);
    expect(await h.ctx.db.select().from(locationSnapshots)).toHaveLength(0);
  });
});
