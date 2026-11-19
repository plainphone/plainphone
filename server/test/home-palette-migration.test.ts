// SPDX-License-Identifier: Apache-2.0
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { inject, it, expect } from "vitest";
import { createDb, migrationsFolder, runMigrations } from "../src/db/client.js";
import { fullHome } from "../src/lib/phone-settings.js";

it("keeps sage for phones that existed before graphite became the default", async () => {
  const prior = await mkdtemp(join(tmpdir(), "plainphone-0038-"));
  const url = new URL(inject("databaseUrl"));
  const admin = createDb(url.href);
  const name = `migration_${randomUUID().replaceAll("-", "")}`;
  url.pathname = `/${name}`;
  const legacy = createDb(url.href);
  try {
    await admin.sql`create database ${admin.sql(name)}`;
    const journal = JSON.parse(await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 38);
    await mkdir(join(prior, "meta"));
    await writeFile(join(prior, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    await Promise.all(entries.map(({ tag }: { tag: string }) =>
      copyFile(join(migrationsFolder, `${tag}.sql`), join(prior, `${tag}.sql`))));
    await migrate(legacy.db, { migrationsFolder: prior });

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
    await legacy.sql.end();
    try {
      await admin.sql`drop database if exists ${admin.sql(name)}`;
    } finally {
      await admin.sql.end();
      await rm(prior, { recursive: true, force: true });
    }
  }
});
