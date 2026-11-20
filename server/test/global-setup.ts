// SPDX-License-Identifier: Apache-2.0
//
// Tests run against a real PostgreSQL. In CI, DATABASE_URL points at a postgres:18
// service container. Locally, without DATABASE_URL, an embedded PostgreSQL 18 is
// started in a temporary directory.
//
// Either way, all migrations run once into a template database. Test files copy it
// (see db.ts) instead of replaying the migrations themselves.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { createDb, runMigrations } from "../src/db/client.js";

const TEMPLATE = "plainphone_template";

async function dropTemplate(baseUrl: string) {
  const admin = createDb(baseUrl);
  try {
    await admin.sql`drop database if exists ${admin.sql(TEMPLATE)} with (force)`;
  } finally {
    await admin.sql.end();
  }
}

async function buildTemplate(baseUrl: string) {
  await dropTemplate(baseUrl);
  const admin = createDb(baseUrl);
  try {
    await admin.sql`create database ${admin.sql(TEMPLATE)}`;
  } finally {
    await admin.sql.end();
  }
  const url = new URL(baseUrl);
  url.pathname = `/${TEMPLATE}`;
  const template = createDb(url.href);
  try {
    await runMigrations(template.db);
  } finally {
    await template.sql.end();
  }
}

export default async function setup(project: TestProject) {
  if (process.env.DATABASE_URL) {
    const url = process.env.DATABASE_URL;
    await buildTemplate(url);
    project.provide("databaseUrl", url);
    project.provide("templateDatabase", TEMPLATE);
    return () => dropTemplate(url);
  }
  const { default: EmbeddedPostgres } = await import("embedded-postgres");
  const dir = await mkdtemp(join(tmpdir(), "plainphone-pg-"));
  const port = 20_000 + Math.floor(Math.random() * 20_000);
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    port,
    user: "plainphone",
    password: "plainphone",
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("plainphone_test");
  const url = `postgres://plainphone:plainphone@127.0.0.1:${port}/plainphone_test`;
  await buildTemplate(url);
  project.provide("databaseUrl", url);
  project.provide("templateDatabase", TEMPLATE);
  return async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    templateDatabase: string;
  }
}
