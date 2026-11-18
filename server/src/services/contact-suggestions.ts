// SPDX-License-Identifier: Apache-2.0
import { randomUUID } from "node:crypto";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import { contactSuggestions, contacts } from "../db/schema.js";
import { phoneNumber } from "../lib/validation.js";
import type { Ctx } from "./context.js";
import { wakePhone } from "./phones.js";

const contactName = z.string().trim().min(1).max(60);
export const selfFavouriteInput = z.strictObject({ name: contactName, number: phoneNumber, favourite: z.boolean() });
export const suggestedContactsInput = z.strictObject({
  contacts: z.array(z.strictObject({ name: contactName, numbers: z.array(phoneNumber).min(1).max(100) })).max(100),
});

export const reviewContactSuggestionsInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("approve"), id: z.uuid() }),
  z.strictObject({ action: z.literal("reject"), id: z.uuid() }),
  z.strictObject({ action: z.literal("approveAll") }),
]);

export async function suggestContacts(ctx: Ctx, phoneId: string, input: z.infer<typeof suggestedContactsInput>) {
  await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select id from phones where id = ${phoneId} for update`);
    const approved = await tx.select({ number: contacts.number }).from(contacts).where(eq(contacts.phoneId, phoneId));
    const approvedNumbers = new Set(approved.map((row) => row.number));
    const existing = await tx.select({
      number: contactSuggestions.number,
      name: contactSuggestions.name,
      groupId: contactSuggestions.groupId,
    }).from(contactSuggestions).where(eq(contactSuggestions.phoneId, phoneId));
    const byNumber = new Map(existing.map((row) => [row.number, row]));
    const candidates: (typeof contactSuggestions.$inferInsert)[] = [];
    for (const contact of input.contacts) {
      const pending = contact.numbers.map((number) => byNumber.get(number)).find((row) => row?.name === contact.name);
      const groupId = pending?.groupId ?? randomUUID();
      for (const number of contact.numbers) {
        if (approvedNumbers.has(number) || byNumber.has(number)) continue;
        const row = { name: contact.name, number, groupId };
        candidates.push({ ...row, phoneId });
        byNumber.set(number, row);
      }
    }
    for (let offset = 0; offset < candidates.length; offset += 100) {
      await tx.insert(contactSuggestions).values(candidates.slice(offset, offset + 100))
        .onConflictDoNothing({ target: [contactSuggestions.phoneId, contactSuggestions.number] });
    }
  });
}

export async function pendingContactSuggestions(ctx: Ctx, phoneId: string) {
  const rows = await ctx.db.select({ id: contactSuggestions.groupId, name: contactSuggestions.name, number: contactSuggestions.number })
    .from(contactSuggestions)
    .where(and(eq(contactSuggestions.phoneId, phoneId), isNotNull(contactSuggestions.name)))
    .orderBy(contactSuggestions.name, contactSuggestions.number);
  const grouped = new Map<string, { id: string; name: string; numbers: string[] }>();
  for (const { id, name, number } of rows) {
    if (name === null) continue;
    const suggestion = grouped.get(id) ?? { id, name, numbers: [] };
    suggestion.numbers.push(number);
    grouped.set(id, suggestion);
  }
  return [...grouped.values()];
}

export async function reviewContactSuggestions(
  ctx: Ctx, phoneId: string, input: z.infer<typeof reviewContactSuggestionsInput>,
) {
  const approved = await ctx.db.transaction(async (tx) => {
    await tx.execute(sql`select id from phones where id = ${phoneId} for update`);
    const pending = await tx.select().from(contactSuggestions).where(and(
      eq(contactSuggestions.phoneId, phoneId),
      isNotNull(contactSuggestions.name),
      input.action === "approveAll" ? undefined : eq(contactSuggestions.groupId, input.id),
    ));
    if (pending.length === 0) return false;
    if (input.action !== "reject") {
      await tx.insert(contacts).values(pending.map(({ name, number }) => ({ phoneId, name: name!, number })))
        .onConflictDoNothing({ target: [contacts.phoneId, contacts.number] });
    }
    await tx.update(contactSuggestions).set({ name: null }).where(and(
      eq(contactSuggestions.phoneId, phoneId),
      input.action === "approveAll" ? undefined : eq(contactSuggestions.groupId, input.id),
    ));
    return input.action !== "reject";
  });
  if (approved) await wakePhone(ctx, phoneId, "rules");
}
