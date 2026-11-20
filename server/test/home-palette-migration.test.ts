// SPDX-License-Identifier: Apache-2.0
import { it, expect } from "vitest";
import { runMigrations } from "../src/db/client.js";
import { fullHome } from "../src/lib/phone-settings.js";
import { createLegacyDatabase, MIGRATION_TEST_TIMEOUT } from "./db.js";

it("keeps sage for phones that existed before graphite became the default", async () => {
  const legacy = await createLegacyDatabase(38);
  try {
    const [household] = await legacy.sql`insert into households (name) values ('Test household') returning id`;
    const phoneIds: string[] = [];
    for (const dnsClientId of ["no-row", "empty-home", "chose-sand"]) {
      const [phone] = await legacy.sql`
        insert into phones (household_id, name, profile, dns_client_id, location_enabled)
        values (${household!.id}, ${dnsClientId}, 'child', ${dnsClientId}, true)
        returning id
      `;
      phoneIds.push(phone!.id as string);
    }
    await legacy.sql`insert into phone_settings (phone_id) values (${phoneIds[1]!})`;
    await legacy.sql`insert into phone_settings (phone_id, home) values (${phoneIds[2]!}, ${JSON.stringify({ palette: "sand" })}::jsonb)`;

    await runMigrations(legacy.db);

    const rows = await legacy.sql`select phone_id, home from phone_settings`;
    const palette = (id: string) => fullHome(rows.find((r) => r.phone_id === id)?.home).palette;
    expect(palette(phoneIds[0]!)).toBe("sage");
    expect(palette(phoneIds[1]!)).toBe("sage");
    expect(palette(phoneIds[2]!)).toBe("sand");

    // A phone enrolled after the migration has no stored palette and gets the new default.
    expect(fullHome(undefined).palette).toBe("grey");
  } finally {
    await legacy.close();
  }
}, MIGRATION_TEST_TIMEOUT);
