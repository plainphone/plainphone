// SPDX-License-Identifier: Apache-2.0
//
// Tests run against a real PostgreSQL. In CI, DATABASE_URL points at a postgres:18
// service container. Locally, without DATABASE_URL, an embedded PostgreSQL 18 is
// started in a temporary directory.

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestProject } from "vitest/node";

export default async function setup(project: TestProject) {
  if (process.env.DATABASE_URL) {
    project.provide("databaseUrl", process.env.DATABASE_URL);
    return;
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
  project.provide("databaseUrl", `postgres://plainphone:plainphone@127.0.0.1:${port}/plainphone_test`);
  return async () => {
    await pg.stop();
    await rm(dir, { recursive: true, force: true });
  };
}

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
