// SPDX-License-Identifier: Apache-2.0
//
// The app catalog: per country, apps a parent can add with one tap (MitID, the bank,
// the school app...). One JSON file per country in server/catalog/. See docs/app-catalog.md.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { packageName } from "../lib/validation.js";

const localized = z.object({ en: z.string().min(1).max(80), da: z.string().min(1).max(80) });
const isoDate = z.iso.date();

export const PLAY_URL = "https://play.google.com/store/apps/details?id=";

const catalogApp = z.object({
  packageName,
  name: z.string().min(1).max(60),
  category: z.string().min(1).max(30),
  starter: z.boolean().default(false),
  source: z.url(),
  verifiedAt: isoDate,
  playTitle: z.string().min(1).max(200),
});

export const catalogFile = z
  .object({
    country: z.string().regex(/^[a-z]{2}$/, "two lowercase letters"),
    name: localized,
    verifiedAt: isoDate,
    categories: z.array(z.object({ id: z.string().regex(/^[a-z][a-z0-9-]{0,29}$/), name: localized })).min(1),
    apps: z.array(catalogApp),
  })
  .superRefine((c, issue) => {
    const ids = new Set<string>();
    c.categories.forEach((cat, i) => {
      if (ids.has(cat.id)) issue.addIssue({ code: "custom", path: ["categories", i, "id"], message: "duplicate category" });
      ids.add(cat.id);
    });
    const seen = new Set<string>();
    c.apps.forEach((a, i) => {
      if (seen.has(a.packageName)) issue.addIssue({ code: "custom", path: ["apps", i], message: "duplicate package" });
      seen.add(a.packageName);
      if (!ids.has(a.category)) issue.addIssue({ code: "custom", path: ["apps", i, "category"], message: "unknown category" });
      if (a.source !== PLAY_URL + a.packageName) {
        issue.addIssue({ code: "custom", path: ["apps", i, "source"], message: "source must be the Play page of the package" });
      }
    });
  });

export type Catalog = z.infer<typeof catalogFile>;
export type CatalogApp = Catalog["apps"][number];

export const catalogDir = fileURLToPath(new URL("../../catalog", import.meta.url));

/** Reads and checks every catalog file. Throws on the first bad file, so a broken catalog stops startup. */
export function loadCatalogs(dir = catalogDir): Map<string, { catalog: Catalog; raw: unknown }> {
  const out = new Map<string, { catalog: Catalog; raw: unknown }>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".json")).sort()) {
    const raw: unknown = JSON.parse(readFileSync(`${dir}/${file}`, "utf8"));
    const parsed = catalogFile.safeParse(raw);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      throw new Error(`catalog/${file}: ${first?.path.join(".")} ${first?.message}`);
    }
    if (`${parsed.data.country}.json` !== file) throw new Error(`catalog/${file}: country must match the file name`);
    out.set(parsed.data.country, { catalog: parsed.data, raw });
  }
  return out;
}

/** Loaded once when the server starts. */
export const CATALOGS = loadCatalogs();

export function getCatalog(country: string): Catalog | undefined {
  return CATALOGS.get(country)?.catalog;
}

/** The catalog a phone gets. Until a parent picks a country, a Danish time zone means Denmark. */
export function phoneCountry(timezone: string): string | null {
  return timezone === "Europe/Copenhagen" && CATALOGS.has("dk") ? "dk" : null;
}

/** Apps allowed from the start when a phone reports them: catalog entries with `starter: true`. */
export const STARTER_PACKS: Record<string, string[]> = Object.fromEntries(
  [...CATALOGS].map(([country, { catalog }]) => [country, catalog.apps.filter((a) => a.starter).map((a) => a.packageName)]),
);
