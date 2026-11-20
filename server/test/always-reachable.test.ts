// SPDX-License-Identifier: Apache-2.0
// The invariant of docs/always-reachable.md, server side: whatever else is switched on or off on a
// phone, its rules still carry every approved contact, the parents marked for SOS and the family
// inbox. The states come from the schema, not from a list: every boolean column is flipped both ways,
// every enum column takes every value, every nullable timestamp is set, every schedule kind is on all
// day and the caps are used up. A new column is picked up by the next run.
import { eq, getTableColumns } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { expect, it } from "vitest";
import { contacts, phones, schedules, sosEvents, timeLimits } from "../src/db/schema.js";
import { pairPhone, signIn, useHarness } from "./harness.js";

const h = useHarness();

/** Columns that switch the reachability feature itself, or change what kind of phone this is. */
const NOT_A_RULE_ON_REACHABILITY = new Set(["profile", "familyInboxEnabled"]);

const MUM = { name: "Mum", number: "+4512345678", sosParent: false };
const DAD = { name: "Dad", number: "+4587654321", sosParent: true };

async function setup() {
  const parent = await signIn(h, "parent@example.org");
  const { phoneId, device } = await pairPhone(h, parent, { profile: "child", name: "Sam" });
  await h.ctx.db.insert(contacts).values([MUM, DAD].map((c) => ({ ...c, phoneId })));
  await h.ctx.db.update(phones).set({ familyInboxEnabled: true, quickMessagesEnabled: true, checkInsEnabled: true }).where(eq(phones.id, phoneId));
  return { phoneId, device };
}

const summary = (rules: any) => ({
  contacts: [...rules.contacts].map((c: any) => `${c.name} ${c.number}`).sort(),
  parents: [...rules.sos.parents].map((c: any) => `${c.name} ${c.number}`).sort(),
});

/** What a column can be set to that differs from now: both booleans, every enum value, a date for a timestamp. */
function variants(column: PgColumn): unknown[] {
  if (column.dataType === "boolean") return [true, false];
  if (column.enumValues?.length) return [...column.enumValues];
  if (column.dataType === "date" && !column.notNull) return [h.clock.now];
  return [];
}

it("keeps every contact, every parent and the family inbox in the rules in every phone state", async () => {
  const { phoneId, device } = await setup();
  const baseline = await device.get("/api/device/rules");
  expect(baseline.status).toBe(200);
  expect(summary(baseline.json).parents).toEqual(["Dad +4587654321"]);
  expect(baseline.json.inbox?.enabled).toBe(true);
  const [original] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));

  const columns = Object.entries(getTableColumns(phones)).filter(([key]) => !NOT_A_RULE_ON_REACHABILITY.has(key));
  let states = 0;
  const wrong: string[] = [];
  for (const [key, column] of columns) {
    for (const value of variants(column)) {
      await h.ctx.db.update(phones).set({ [key]: value }).where(eq(phones.id, phoneId));
      const rules = await device.get("/api/device/rules");
      states++;
      if (rules.status !== 200) wrong.push(`${key}=${String(value)}: rules answer ${rules.status}`);
      else {
        const now = summary(rules.json);
        if (JSON.stringify(now) !== JSON.stringify(summary(baseline.json))) wrong.push(`${key}=${String(value)}: contacts or parents changed`);
        if (rules.json.inbox?.enabled !== true) wrong.push(`${key}=${String(value)}: the family inbox left the rules`);
      }
      await h.ctx.db.update(phones).set(original!).where(eq(phones.id, phoneId));
    }
  }
  // The suite is only worth something if it really walked through the schema.
  expect(states).toBeGreaterThan(40);
  expect(wrong).toEqual([]);
});

it("keeps them in the rules with every schedule kind on all day and every cap used up", async () => {
  const { phoneId, device } = await setup();
  const kinds = schedules.kind.enumValues;
  expect(kinds).toEqual(expect.arrayContaining(["school", "bedtime"]));
  await h.ctx.db.insert(schedules).values(kinds.map((kind) => ({
    phoneId, kind, days: [1, 2, 3, 4, 5, 6, 7], startMinute: 0, endMinute: 0, allowedPackages: [],
  })));
  await h.ctx.db.insert(timeLimits).values([{ phoneId, packageName: "*", minutes: 0 }, { phoneId, packageName: "com.example.game", minutes: 0 }]);
  const rules = await device.get("/api/device/rules");
  expect(rules.status).toBe(200);
  expect(rules.json.schedules.map((s: any) => s.kind).sort()).toEqual([...kinds].sort());
  expect(rules.json.timeLimits.total.minutes).toBe(0);
  expect(summary(rules.json)).toEqual({ contacts: ["Dad +4587654321", "Mum +4512345678"], parents: ["Dad +4587654321"] });
  expect(rules.json.inbox.enabled).toBe(true);
});

it("a phone the parents released still gets its contacts, and an SOS it already sent by SMS is still recorded", async () => {
  const { phoneId, device } = await setup();
  await h.ctx.db.update(phones).set({ releaseRequestedAt: h.clock.now }).where(eq(phones.id, phoneId));
  const rules = await device.get("/api/device/rules");
  expect(rules.json.release).toBe(true);
  expect(summary(rules.json).contacts).toHaveLength(2);
  // The phone is the authority for what it has already done (docs/sos.md): the SMS went out, so it is recorded.
  const id = crypto.randomUUID();
  const sos = await device.post("/api/device/sos", { id, kind: "urgent", smsSubmitted: true });
  expect(sos.status).toBe(200);
  const [recorded] = await h.ctx.db.select().from(sosEvents).where(eq(sosEvents.id, id));
  expect(recorded?.deliveredVia).toBe("sms");
});
