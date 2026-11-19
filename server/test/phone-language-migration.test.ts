// SPDX-License-Identifier: Apache-2.0
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { inject, it, expect } from "vitest";
import { createDb, migrationsFolder, runMigrations } from "../src/db/client.js";

it("upgrades a phone from migration 0018 without assigning a language", async () => {
  const prior = await mkdtemp(join(tmpdir(), "plainphone-0018-"));
  const url = new URL(inject("databaseUrl"));
  const admin = createDb(url.href);
  const name = `migration_${randomUUID().replaceAll("-", "")}`;
  url.pathname = `/${name}`;
  const legacy = createDb(url.href);
  try {
    await admin.sql`create database ${admin.sql(name)}`;
    const journal = JSON.parse(await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= 18);
    await mkdir(join(prior, "meta"));
    await writeFile(join(prior, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    await Promise.all(entries.map(({ tag }: { tag: string }) =>
      copyFile(join(migrationsFolder, `${tag}.sql`), join(prior, `${tag}.sql`))));
    await migrate(legacy.db, { migrationsFolder: prior });

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
    await legacy.sql.end();
    try {
      await admin.sql`drop database if exists ${admin.sql(name)}`;
    } finally {
      await admin.sql.end();
      await rm(prior, { recursive: true, force: true });
    }
  }
});
