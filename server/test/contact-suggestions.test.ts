// SPDX-License-Identifier: Apache-2.0
import { readFile } from "node:fs/promises";
import { sql } from "drizzle-orm";
import { expect, it } from "vitest";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

it("keeps suggestions separate from rules until approved and remembers reviewed numbers", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  expect((await parent.patch(`/api/phones/${phoneId}/contacts`, { suggestDeviceContacts: true })).status).toBe(204);
  const path = `/api/phones/${phoneId}/contact-suggestions`;
  const contacts = [
    { name: "Alex", numbers: ["+4512345678", "+4512345679"] },
    { name: "Sam", numbers: ["+4523456789", "+4523456790"] },
    { name: "Jo", numbers: ["+4534567890"] },
    { name: "Chris", numbers: ["+4512345678", "+4534567891"] },
  ];
  const report = (entries: typeof contacts) => device.put("/api/device/contact-suggestions", { contacts: entries });
  expect((await report(contacts)).status).toBe(204);
  const listed = (await parent.get(path)).json.suggestions;
  expect(listed).toHaveLength(4);
  const alex = listed.find((s: { name: string }) => s.name === "Alex");
  const sam = listed.find((s: { name: string }) => s.name === "Sam");
  expect(alex.numbers).toEqual(contacts[0]!.numbers);
  expect(listed.find((s: { name: string }) => s.name === "Chris").numbers).toEqual(["+4534567891"]);
  expect((await device.get("/api/device/rules")).json.contacts).toEqual([]);
  expect((await parent.post(path, { action: "approve", id: alex.id })).status).toBe(204);
  expect((await parent.post(path, { action: "reject", id: sam.id })).status).toBe(204);
  expect((await parent.post(path, { action: "approveAll", suggestionIds: listed.map((s: { id: string }) => s.id) })).status).toBe(204);
  expect((await device.get("/api/device/rules")).json.contacts).toEqual([
    { name: "Alex", number: "+4512345678" },
    { name: "Alex", number: "+4512345679" },
    { name: "Chris", number: "+4534567891" },
    { name: "Jo", number: "+4534567890" },
  ]);
  expect((await report([...contacts, { name: "New", numbers: ["+4545678901"] }])).status).toBe(204);
  expect((await parent.get(path)).json.suggestions.map((s: { name: string }) => s.name)).toEqual(["New"]);
});

it("only approves the groups and numbers shown in the review", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  expect((await parent.patch(`/api/phones/${phoneId}/contacts`, { suggestDeviceContacts: true })).status).toBe(204);
  const path = `/api/phones/${phoneId}/contact-suggestions`;
  const report = (contacts: { name: string; numbers: string[] }[]) =>
    device.put("/api/device/contact-suggestions", { contacts });
  const alex = { name: "Alex", numbers: ["+4512345678"] };
  const jo = { name: "Jo", numbers: ["+4534567890"] };
  const removed = { name: "Sam", numbers: ["+4523456789"] };
  const incorrect = { name: "Pat", numbers: ["+4523456790"] };
  expect((await report([alex, jo, removed, incorrect])).status).toBe(204);
  const initial = (await parent.get(path)).json.suggestions;
  const oldAlex = initial.find((s: { name: string }) => s.name === "Alex");
  const updated = { name: "Alex", numbers: [...alex.numbers, "+4512345679"] };
  const added = { name: "New", numbers: ["+4545678901"] };
  const corrected = { name: "Pat", numbers: ["+4523456791"] };
  expect((await report([updated, jo, added, corrected])).status).toBe(204);
  expect((await parent.post(path, { action: "approve", id: oldAlex.id })).status).toBe(204);
  expect((await device.get("/api/device/rules")).json.contacts).toEqual([]);
  expect((await parent.post(path, { action: "approveAll", suggestionIds: initial.map((s: { id: string }) => s.id) })).status).toBe(204);
  expect((await device.get("/api/device/rules")).json.contacts).toEqual([{ name: "Jo", number: jo.numbers[0] }]);
  expect((await parent.get(path)).json.suggestions).toEqual([
    { ...updated, id: expect.any(String) },
    { ...added, id: expect.any(String) },
    { ...corrected, id: expect.any(String) },
  ]);
  expect((await report([])).status).toBe(204);
  expect((await parent.get(path)).json.suggestions).toEqual([]);
});

it("accepts a complete address book including contacts with more than 100 numbers", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  expect((await parent.patch(`/api/phones/${phoneId}/contacts`, { suggestDeviceContacts: true })).status).toBe(204);
  const numbers = Array.from({ length: 101 }, (_, i) => `+451234${(1000 + i).toString()}`);
  const ordinary = Array.from({ length: 101 }, (_, i) => ({ name: `Contact ${i}`, numbers: [`+452345${1000 + i}`] }));
  expect((await device.put("/api/device/contact-suggestions", {
    contacts: [{ name: "Many numbers", numbers }, ...ordinary],
  })).status).toBe(204);
  const suggestions = (await parent.get(`/api/phones/${phoneId}/contact-suggestions`)).json.suggestions;
  expect(suggestions).toHaveLength(102);
  expect(suggestions.find((s: { name: string }) => s.name === "Many numbers").numbers).toEqual(numbers);
});

it("accepts only names and numbers from a child phone", async () => {
  const parent = await signIn(h, "parent@example.org");
  const child = await pairPhone(h, parent, { profile: "child" });
  expect((await parent.patch(`/api/phones/${child.phoneId}/contacts`, { suggestDeviceContacts: true })).status).toBe(204);
  const self = await pairPhone(h, parent, { profile: "self" });
  const path = "/api/device/contact-suggestions";
  const contact = { name: "Alex", numbers: ["+4512345678"] };
  expect((await self.device.put(path, { contacts: [contact] })).status).toBe(404);
  expect((await child.device.put(path, { contacts: [{ ...contact, body: "private" }] })).status).toBe(400);
});

it("sets up favourites before restrictions and uses the Self key to loosen them", async () => {
  const parent = await signIn(h, "self@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "self" });
  const restriction = `/api/phones/${phoneId}/contact-schedule`;
  const path = "/api/device/self/favourites";
  const alex = { name: "Alex", number: "+4512345678" };
  const sam = { name: "Sam", number: "+4523456789" };
  expect((await device.post(path, { ...alex, favourite: true })).status).toBe(204);
  expect((await device.get("/api/device/rules")).json.selfScheduleContacts).toBe(false);
  expect((await parent.put(restriction, { restricted: true })).status).toBe(200);
  expect((await device.get("/api/device/rules")).json.selfScheduleContacts).toBe(true);
  expect((await device.post(path, { ...sam, favourite: true })).status).toBe(202);
  expect((await device.post(path, { ...sam, favourite: true })).status).toBe(202);
  expect((await parent.put(restriction, { restricted: false })).status).toBe(202);
  const rules = (await device.get("/api/device/rules")).json;
  expect(rules.contacts).toEqual([alex]);
  expect(rules.selfScheduleContacts).toBe(true);
});

it("requires opt-in and clears pending suggestions after opt-out", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
  const path = `/api/phones/${phoneId}/contact-suggestions`;
  const settings = `/api/phones/${phoneId}/contacts`;
  const report = () => device.put("/api/device/contact-suggestions", { contacts: [
    { name: "Alex", numbers: ["+4512345678"] },
  ] });
  const rules = () => device.get("/api/device/rules");
  expect((await rules()).json.suggestDeviceContacts).toBe(false);
  expect((await report()).status).toBe(403);
  expect((await parent.patch(settings, { suggestDeviceContacts: true })).status).toBe(204);
  expect((await rules()).json.suggestDeviceContacts).toBe(true);
  expect((await report()).status).toBe(204);
  expect((await parent.get(path)).json.suggestions).toHaveLength(1);
  expect((await parent.patch(settings, { suggestDeviceContacts: false })).status).toBe(204);
  expect((await rules()).json.suggestDeviceContacts).toBe(false);
  expect((await report()).status).toBe(403);
  expect((await parent.get(path)).json.suggestions).toEqual([]);
});

it("keeps the contact restriction off for paired light children when upgrading", async () => {
  const migration = await readFile(new URL("../drizzle/0016_contact_suggestions_and_self_schedule.sql", import.meta.url), "utf8");
  await h.ctx.db.transaction(async (tx) => {
    await tx.execute(sql`
      create temp table phones (
        scenario text, mode text, profile text, paired_at timestamptz, device_token_hash text
      ) on commit drop
    `);
    await tx.execute(sql`
      insert into phones values
        ('synced', 'light', 'child', now(), 'synced-token-hash'),
        ('before first sync', 'light', 'child', null, 'confirmed-token-hash'),
        ('awaiting confirmation', 'light', 'child', null, null),
        ('strong', 'strong', 'child', now(), 'strong-token-hash')
    `);
    for (const statement of migration.split("--> statement-breakpoint").filter((part) => /"suggest_device_contacts"|"light_contact_restriction"/.test(part))) {
      await tx.execute(sql.raw(statement));
    }
    await tx.execute(sql`insert into phones values ('new', 'light', 'child', now(), 'new-token-hash')`);
    const rows = await tx.execute(sql`
      select scenario, suggest_device_contacts, light_contact_restriction from phones order by scenario
    `);
    expect([...rows]).toEqual([
      { scenario: "awaiting confirmation", suggest_device_contacts: false, light_contact_restriction: true },
      { scenario: "before first sync", suggest_device_contacts: false, light_contact_restriction: false },
      { scenario: "new", suggest_device_contacts: false, light_contact_restriction: true },
      { scenario: "strong", suggest_device_contacts: false, light_contact_restriction: true },
      { scenario: "synced", suggest_device_contacts: false, light_contact_restriction: false },
    ]);
  });
});

it("enables contact restriction on newly paired light children and lets the parent turn it off", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child", mode: "light" });
  expect((await device.get("/api/device/rules")).json.lightContactRestriction).toBe(true);
  expect((await parent.patch(`/api/phones/${phoneId}/contacts`, { lightContactRestriction: false })).status).toBe(204);
  expect((await device.get("/api/device/rules")).json.lightContactRestriction).toBe(false);
});
