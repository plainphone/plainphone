// SPDX-License-Identifier: Apache-2.0
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import * as schema from "./schema.js";

export type Db = ReturnType<typeof createDb>["db"];

/** The pool size the server has always used; DB_POOL_MAX changes it (docs/operations.md#capacity). */
export const DEFAULT_POOL_MAX = 10;

export function createDb(url: string, max = DEFAULT_POOL_MAX) {
  const sql = postgres(url, { max, onnotice: () => {} });
  const db = drizzle(sql, { schema });
  return { db, sql };
}

export const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

export async function runMigrations(db: Db) {
  await migrate(db, { migrationsFolder });
}
