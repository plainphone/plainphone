// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { contactSuggestions, contacts, phones } from "../db/schema.js";
import { phoneNumber } from "../lib/validation.js";
import type { Ctx } from "./context.js";
import { wakePhone } from "./phones.js";

const contactName = z.string().trim().min(1).max(60);
export const selfFavouriteInput = z.strictObject({ name: contactName, number: phoneNumber, favourite: z.boolean() });
export const suggestedContactsInput = z.strictObject({
  contacts: z.array(z.strictObject({ name: contactName, numbers: z.array(phoneNumber).min(1) })),
});

export const reviewContactSuggestionsInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("approve"), id: z.uuid() }),
  z.strictObject({ action: z.literal("reject"), id: z.uuid() }),
  z.strictObject({ action: z.literal("approveAll"), suggestionIds: z.array(z.uuid()).min(1) }),
]);

type Suggestion = { id: string; name: string; numbers: string[] };

function groupRows(rows: { id: string; name: string | null; number: string }[]): Suggestion[] {
  const grouped = new Map<string, Suggestion>();
  for (const { id, name, number } of rows) {
    if (name === null) continue;
    const suggestion = grouped.get(id) ?? { id, name, numbers: [] };
    suggestion.numbers.push(number);
    grouped.set(id, suggestion);
  }
  return [...grouped.values()];
}

const suggestionKey = ({ name, numbers }: Omit<Suggestion, "id">) => JSON.stringify([name, numbers]);

export const childContactSettingsInput = z.strictObject({
  suggestDeviceContacts: z.boolean().optional(),
  lightContactRestriction: z.boolean().optional(),
}).refine((input) => input.suggestDeviceContacts !== undefined || input.lightContactRestriction !== undefined);

export async function updateChildContactSettings(ctx: Ctx, phoneId: string, input: z.infer<typeof childContactSettingsInput>) {
  const result = await ctx.db.transaction(async (tx) => {
    const columns = {
      suggestDeviceContacts: phones.suggestDeviceContacts,
      lightContactRestriction: phones.lightContactRestriction,
    };
    const [before] = await tx.select(columns).from(phones).where(eq(phones.id, phoneId)).for("update");
    if (!before) return null;
    const [after] = await tx.update(phones).set(input).where(eq(phones.id, phoneId)).returning(columns);
    if (input.suggestDeviceContacts === false) {
      await tx.delete(contactSuggestions).where(and(eq(contactSuggestions.phoneId, phoneId), isNotNull(contactSuggestions.name)));
    }
    return { before, after };
  });
  if (result) await wakePhone(ctx, phoneId, "rules");
  return result;
}

export async function suggestContacts(ctx: Ctx, phoneId: string, input: z.infer<typeof suggestedContactsInput>) {
  return ctx.db.transaction(async (tx) => {
    const [phone] = await tx.select({ enabled: phones.suggestDeviceContacts }).from(phones)
      .where(eq(phones.id, phoneId)).for("update");
    if (!phone?.enabled) return false;
    const approved = await tx.select({ number: contacts.number }).from(contacts).where(eq(contacts.phoneId, phoneId));
    const existing = await tx.select({
      number: contactSuggestions.number,
      name: contactSuggestions.name,
      id: contactSuggestions.groupId,
    }).from(contactSuggestions).where(eq(contactSuggestions.phoneId, phoneId)).orderBy(contactSuggestions.number);
    const seen = new Set(approved.map((row) => row.number));
    for (const row of existing) {
      if (row.name === null) seen.add(row.number);
    }
    const pending = new Map(groupRows(existing).map((group) => [suggestionKey(group), group.id]));
    const candidates: (typeof contactSuggestions.$inferInsert)[] = [];
    for (const { name, numbers } of input.contacts) {
      const fresh = [];
      for (const number of numbers) {
        if (seen.has(number)) continue;
        seen.add(number);
        fresh.push(number);
      }
      if (fresh.length === 0) continue;
      // A review ID identifies exactly the name and numbers displayed to the parent.
      if (pending.delete(suggestionKey({ name, numbers: fresh.sort() }))) continue;
      const groupId = randomUUID();
      for (const number of fresh) candidates.push({ phoneId, groupId, name, number });
    }
    const obsolete = [...pending.values()];
    for (let offset = 0; offset < obsolete.length; offset += 100) {
      await tx.delete(contactSuggestions).where(and(
        eq(contactSuggestions.phoneId, phoneId),
        isNotNull(contactSuggestions.name),
        inArray(contactSuggestions.groupId, obsolete.slice(offset, offset + 100)),
      ));
    }
    for (let offset = 0; offset < candidates.length; offset += 100) {
      await tx.insert(contactSuggestions).values(candidates.slice(offset, offset + 100));
    }
    return true;
  });
}

export async function pendingContactSuggestions(ctx: Ctx, phoneId: string) {
  const rows = await ctx.db.select({ id: contactSuggestions.groupId, name: contactSuggestions.name, number: contactSuggestions.number })
    .from(contactSuggestions)
    .where(and(eq(contactSuggestions.phoneId, phoneId), isNotNull(contactSuggestions.name)))
    .orderBy(contactSuggestions.name, contactSuggestions.number);
  return groupRows(rows);
}

export async function reviewContactSuggestions(
  ctx: Ctx, phoneId: string, input: z.infer<typeof reviewContactSuggestionsInput>,
) {
  const approved = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select id from phones where id = ${phoneId} for update`);
    const ids = input.action === "approveAll" ? [...new Set(input.suggestionIds)] : [input.id];
    let changed = false;
    for (let offset = 0; offset < ids.length; offset += 100) {
      const selected = and(
        eq(contactSuggestions.phoneId, phoneId),
        isNotNull(contactSuggestions.name),
        inArray(contactSuggestions.groupId, ids.slice(offset, offset + 100)),
      );
      if (input.action === "reject") {
        await tx.update(contactSuggestions).set({ name: null }).where(selected);
        continue;
      }
      const reviewed = await tx.select({ name: contactSuggestions.name, number: contactSuggestions.number })
        .from(contactSuggestions).where(selected);
      if (reviewed.length === 0) continue;
      for (let start = 0; start < reviewed.length; start += 100) {
        await tx.insert(contacts).values(reviewed.slice(start, start + 100)
          .map(({ name, number }) => ({ phoneId, name: name!, number })))
          .onConflictDoNothing({ target: [contacts.phoneId, contacts.number] });
      }
      await tx.update(contactSuggestions).set({ name: null }).where(selected);
      changed = true;
    }
    return changed;
  });
  if (approved) await wakePhone(ctx, phoneId, "rules");
}
