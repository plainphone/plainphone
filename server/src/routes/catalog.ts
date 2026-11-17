// SPDX-License-Identifier: Apache-2.0
//
// The app catalog (docs/app-catalog.md). The country lists are public; what a phone has
// added from them sits behind the parent session.

import { eq } from "drizzle-orm";
import { type Env, Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import { phoneApps } from "../db/schema.js";
import { body } from "../lib/http.js";
import { packageName } from "../lib/validation.js";
import { CATALOGS, getCatalog, phoneCountry } from "../services/catalog.js";
import type { Ctx } from "../services/context.js";
import type { PhoneRouteHelpers } from "./limits.js";

/** Public, no session: `GET /catalog` and `GET /catalog/:country`. */
export function publicCatalogRoutes() {
  const app = new Hono();
  app.get("/", (c) => {
    c.header("Cache-Control", "public, max-age=3600");
    return c.json([...CATALOGS.values()].map(({ catalog }) => ({ country: catalog.country, name: catalog.name })));
  });
  app.get("/:country", (c) => {
    const entry = CATALOGS.get(c.req.param("country"));
    if (!entry) throw new HTTPException(404, { message: "no catalog for this country" });
    c.header("Cache-Control", "public, max-age=3600");
    return c.json(entry.raw as object);
  });
  return app;
}

export type CatalogState = "installed-allowed" | "installed-hidden" | "requested" | "none";

export function phoneCatalogRoutes<E extends Env>(app: Hono<E>, ctx: Ctx, { requirePhone, change }: PhoneRouteHelpers<E>) {
  app.get("/phones/:pid/catalog", async (c) => {
    const phone = await requirePhone(c);
    const country = phoneCountry(phone.timezone);
    const catalog = country ? getCatalog(country) : undefined;
    if (!catalog) return c.json({ country: null, categories: [], apps: [] });
    const rows = await ctx.db.select().from(phoneApps).where(eq(phoneApps.phoneId, phone.id));
    const byPkg = new Map(rows.map((r) => [r.packageName, r]));
    return c.json({
      country: catalog.country,
      categories: catalog.categories,
      apps: catalog.apps.map((a) => {
        const r = byPkg.get(a.packageName);
        const state: CatalogState = !r
          ? "none"
          : r.installed
            ? r.allowed || r.core
              ? "installed-allowed"
              : "installed-hidden"
            : r.requested && r.allowed
              ? "requested"
              : "none";
        return { ...a, state };
      }),
    });
  });

  app.post("/phones/:pid/catalog", async (c) => {
    const phone = await requirePhone(c);
    const input = await body(c, z.object({ packageName }));
    const country = phoneCountry(phone.timezone);
    const entry = country ? getCatalog(country)?.apps.find((a) => a.packageName === input.packageName) : undefined;
    // submitChange checks again inside its transaction; this only finds the label.
    return change(c, phone, { type: "catalog.add", packageName: input.packageName, label: entry?.name ?? input.packageName });
  });

  app.delete("/phones/:pid/catalog/:package", async (c) => {
    const phone = await requirePhone(c);
    const pkg = packageName.safeParse(c.req.param("package"));
    if (!pkg.success) throw new HTTPException(404, { message: "not found" });
    return change(c, phone, { type: "catalog.remove", packageName: pkg.data });
  });
}
