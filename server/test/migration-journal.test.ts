// SPDX-License-Identifier: Apache-2.0
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, it } from "vitest";
import { migrationsFolder } from "../src/db/client.js";

interface Entry { idx: number; tag: string; when: number }

/**
 * Drizzle's migrator skips, without an error, a migration whose `when` is not newer than the
 * newest one already applied. Renumbering or merging branches can leave an older timestamp
 * behind a newer one, so production would never run that migration.
 */
export function journalProblems(entries: Entry[]): string[] {
  const problems: string[] = [];
  entries.forEach((entry, i) => {
    const prev = entries[i - 1];
    if (!prev) return;
    if (entry.idx <= prev.idx) problems.push(`${entry.tag}: idx ${entry.idx} is not after ${prev.tag} (${prev.idx})`);
    if (entry.when <= prev.when) problems.push(`${entry.tag}: when ${entry.when} is not after ${prev.tag} (${prev.when})`);
  });
  return problems;
}

const journal = JSON.parse(readFileSync(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as { entries: Entry[] };

it("flags a journal whose timestamps do not strictly increase", () => {
  expect(journalProblems([
    { idx: 1, tag: "0001_a", when: 10 },
    { idx: 2, tag: "0002_b", when: 10 },
    { idx: 3, tag: "0003_c", when: 5 },
  ])).toHaveLength(2);
  expect(journalProblems([{ idx: 1, tag: "0001_a", when: 10 }, { idx: 2, tag: "0002_b", when: 11 }])).toEqual([]);
});

it("keeps every migration journal timestamp strictly increasing", () => {
  expect(journalProblems(journal.entries)).toEqual([]);
});

it("has a SQL file for every journal entry, a matching number and no stray SQL files", () => {
  const tags = journal.entries.map((entry) => entry.tag);
  expect(new Set(tags).size).toBe(tags.length);
  for (const entry of journal.entries) {
    expect(entry.tag.startsWith(String(entry.idx).padStart(4, "0")), `${entry.tag} number matches idx ${entry.idx}`).toBe(true);
    expect(existsSync(join(migrationsFolder, `${entry.tag}.sql`)), `${entry.tag}.sql exists`).toBe(true);
  }
  const files = readdirSync(migrationsFolder).filter((name) => name.endsWith(".sql")).map((name) => name.slice(0, -4));
  expect(files.sort()).toEqual([...tags].sort());
});

it("chains each snapshot to the previous one through prevId", () => {
  const snapshots = journal.entries
    .map((entry) => join(migrationsFolder, "meta", `${entry.tag.slice(0, 4)}_snapshot.json`))
    .filter(existsSync)
    .map((file) => JSON.parse(readFileSync(file, "utf8")) as { id: string; prevId: string });
  for (let i = 1; i < snapshots.length; i++) {
    expect(snapshots[i]!.prevId, `snapshot ${i} follows snapshot ${i - 1}`).toBe(snapshots[i - 1]!.id);
  }
});
