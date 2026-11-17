// SPDX-License-Identifier: Apache-2.0
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { useHarness } from "./harness.js";

const h = useHarness();
type Plan = { "Node Type": string; "Index Name"?: string; Plans?: Plan[] };

function indexes(plan: Plan): string[] {
  return [...(plan["Index Name"] ? [plan["Index Name"]] : []), ...(plan.Plans ?? []).flatMap(indexes)];
}

test("sweeper uses range indexes when few rows are due", async () => {
  const db = h.ctx.db;
  await db.execute(sql`
    insert into magic_links (email, token_hash, expires_at)
    select 'bench@example.test', i::text, now() + (i - 3) * interval '1 hour'
    from generate_series(1, 20000) i
  `);
  await db.execute(sql`
    with owner as (insert into users (email) values ('bench@example.test') returning id)
    insert into sessions (user_id, token_hash, expires_at)
    select owner.id, i::text, now() + (i - 3) * interval '1 hour'
    from owner cross join generate_series(1, 20000) i
  `);
  await db.execute(sql`
    with home as (insert into households (name) values ('Benchmark') returning id),
    phone as (
      insert into phones (household_id, name, profile, location_enabled, dns_client_id)
      select id, 'Benchmark', 'self', false, 'bench' from home returning id
    )
    insert into pending_changes (phone_id, op, key_type, status, effective_at)
    select phone.id, '{}'::jsonb, 'delay', case when i < 10 then 'pending' else 'applied' end,
      now() + (i - 3) * interval '1 hour'
    from phone cross join generate_series(1, 20000) i
  `);

  for (const [table, query, index] of [
    ["magic_links", "delete from magic_links where expires_at < now() - interval '1 hour'", "magic_links_expires_idx"],
    ["sessions", "delete from sessions where expires_at < now()", "sessions_expires_idx"],
    ["pending_changes", "select id from pending_changes where status = 'pending' and key_type = 'delay' and effective_at <= now()", "pending_changes_due_idx"],
  ]) {
    await db.execute(sql.raw(`analyze ${table}`));
    const [result] = await db.execute<{ "QUERY PLAN": { Plan: Plan }[] }>(sql.raw(`explain (format json) ${query}`));
    expect(indexes(result!["QUERY PLAN"][0]!.Plan)).toContain(index);
  }
});
