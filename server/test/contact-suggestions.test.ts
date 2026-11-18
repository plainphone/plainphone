// SPDX-License-Identifier: Apache-2.0
import { expect, it } from "vitest";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

it("keeps suggestions separate from rules until approved and remembers reviewed numbers", async () => {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child" });
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
  expect((await parent.post(path, { action: "approveAll" })).status).toBe(204);
  expect((await device.get("/api/device/rules")).json.contacts).toEqual([
    { name: "Alex", number: "+4512345678" },
    { name: "Alex", number: "+4512345679" },
    { name: "Chris", number: "+4534567891" },
    { name: "Jo", number: "+4534567890" },
  ]);
  expect((await report([...contacts, { name: "New", numbers: ["+4545678901"] }])).status).toBe(204);
  expect((await parent.get(path)).json.suggestions.map((s: { name: string }) => s.name)).toEqual(["New"]);
});

it("accepts only names and numbers from a child phone", async () => {
  const parent = await signIn(h, "parent@example.org");
  const child = await pairPhone(h, parent, { profile: "child" });
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
