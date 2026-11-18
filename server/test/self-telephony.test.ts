// SPDX-License-Identifier: Apache-2.0
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { phones } from "../src/db/schema.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

it("uses the Self key when coming from an always-restricted contact list", async () => {
  const owner = await signIn(h, "self@example.org");
  const { phoneId, device } = await pairPhone(h, owner, { profile: "self" });
  await h.ctx.db.update(phones).set({ selfScheduleContacts: null }).where(eq(phones.id, phoneId));

  const contacts = await owner.get(`/api/phones/${phoneId}/contacts`);
  expect(contacts.json.selfScheduleContacts).toBeNull();
  for (const restricted of [true, false]) {
    const result = await owner.put(`/api/phones/${phoneId}/contact-schedule`, { restricted });
    expect(result.status).toBe(202);
    const pending = await owner.get(`/api/phones/${phoneId}/changes`);
    const change = pending.json.changes.find((row: { id: string }) => row.id === result.json.change.id);
    expect(change.summary.en).toBe(
      `Calls and texts during schedules: favourites only at all times → ${restricted ? "favourites only" : "anyone"}`,
    );
  }
  const add = await device.post("/api/device/self/favourites", {
    name: "Alex", number: "+4512345678", favourite: true,
  });
  expect(add.status).toBe(202);
  const { json } = await device.get("/api/device/rules");
  expect(json.contacts).toEqual([]);
  expect(json.selfScheduleContacts).toBeNull();
});
