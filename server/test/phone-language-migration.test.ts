// SPDX-License-Identifier: Apache-2.0
import { it, expect } from "vitest";
import { runMigrations } from "../src/db/client.js";
import { createLegacyDatabase, MIGRATION_TEST_TIMEOUT } from "./db.js";

it("upgrades a phone from migration 0018 without assigning a language", async () => {
  const legacy = await createLegacyDatabase(18);
  try {
    const [household] = await legacy.sql`insert into households (name) values ('Test household') returning id`;
    const [phone] = await legacy.sql`
      insert into phones (household_id, name, profile, dns_client_id, location_enabled)
      values (${household!.id}, 'Existing phone', 'child', 'test-0018', true)
      returning id
    `;
    await runMigrations(legacy.db);
    expect(await legacy.sql`select name, language from phones where id = ${phone!.id}`)
      .toEqual([{ name: "Existing phone", language: null }]);
  } finally {
    await legacy.close();
  }
}, MIGRATION_TEST_TIMEOUT);
