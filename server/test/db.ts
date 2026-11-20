// SPDX-License-Identifier: Apache-2.0
//
// Database helpers for tests. global-setup.ts migrates one template database per run; every
// test file copies it with CREATE DATABASE ... TEMPLATE, so nothing replays migrations twice.
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { inject } from "vitest";
import { createDb, migrationsFolder } from "../src/db/client.js";

/** Replaying migrations is slow on a busy machine: tests that do it need this timeout. */
export const MIGRATION_TEST_TIMEOUT = 60_000;

function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${name}`;
  return u.href;
}

const newName = () => `test_${randomUUID().replaceAll("-", "")}`;

async function dropDatabase(name: string) {
  const admin = createDb(inject("databaseUrl"));
  try {
    await admin.sql`drop database if exists ${admin.sql(name)} with (force)`;
  } finally {
    await admin.sql.end();
  }
}

/** A fully migrated database copied from the run's template. */
export async function createTestDatabase() {
  const admin = createDb(inject("databaseUrl"));
  const name = newName();
  try {
    await admin.sql`create database ${admin.sql(name)} template ${admin.sql(inject("templateDatabase"))}`;
  } finally {
    await admin.sql.end();
  }
  return { url: withDatabase(inject("databaseUrl"), name), name, drop: () => dropDatabase(name) };
}

/**
 * A database migrated only up to journal index `upToIdx`, for tests of one migration's backfill.
 * These cannot use the template, so they replay by hand: give the test MIGRATION_TEST_TIMEOUT.
 */
export async function createLegacyDatabase(upToIdx: number) {
  const prior = await mkdtemp(join(tmpdir(), `plainphone-${upToIdx}-`));
  const name = newName();
  const admin = createDb(inject("databaseUrl"));
  const legacy = createDb(withDatabase(inject("databaseUrl"), name));
  const close = async () => {
    await legacy.sql.end();
    try {
      await dropDatabase(name);
    } finally {
      await admin.sql.end();
      await rm(prior, { recursive: true, force: true });
    }
  };
  try {
    await admin.sql`create database ${admin.sql(name)}`;
    const journal = JSON.parse(await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"));
    const entries = journal.entries.filter((entry: { idx: number }) => entry.idx <= upToIdx);
    await mkdir(join(prior, "meta"));
    await writeFile(join(prior, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }));
    await Promise.all(entries.map(({ tag }: { tag: string }) =>
      copyFile(join(migrationsFolder, `${tag}.sql`), join(prior, `${tag}.sql`))));
    await migrate(legacy.db, { migrationsFolder: prior });
  } catch (e) {
    await close();
    throw e;
  }
  return { db: legacy.db, sql: legacy.sql, close };
}
