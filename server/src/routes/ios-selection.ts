// SPDX-License-Identifier: Apache-2.0
//
// iPhone app selections (docs/ios/architecture.md, "App selections"). Contract: server/openapi.yaml.

import type { Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import type { phones } from "../db/schema.js";
import { iosSelectionInput, MAX_IOS_SELECTION_CHARS } from "../lib/ios.js";
import { body } from "../lib/http.js";
import type { Ctx } from "../services/context.js";
import type { ParentEnv } from "./parent.js";
import { canPickApps, loadIosSelection, saveIosSelection, type IosSelectionSource } from "../services/ios-selection.js";

type Phone = typeof phones.$inferSelect;

/** JSON around the largest selection; anything bigger is refused before it is parsed. */
const limit = bodyLimit({
  maxSize: MAX_IOS_SELECTION_CHARS + 1024,
  onError: (c) => c.json({ error: "selection too large" }, 413),
});

const notSupported = (source: IosSelectionSource) => ({
  error: source === "parent" ? "apps for this phone cannot be picked on another device" : "this phone cannot pick its own apps",
  code: "not_supported",
});

async function selectionJson(ctx: Ctx, phoneId: string) {
  const row = await loadIosSelection(ctx.db, phoneId);
  return { selection: row?.selection ?? null, source: row?.source ?? null, updatedAt: row?.updatedAt.toISOString() ?? null };
}

/** The phone's side: it fetches what the parent picked, and reports what was picked on it. */
export function deviceIosSelectionRoutes(app: Hono<{ Variables: { phone: Phone } }>, ctx: Ctx) {
  app.get("/ios-selection", async (c) => {
    const phone = c.get("phone");
    if (phone.platform !== "ios") throw new HTTPException(404, { message: "not found" });
    c.header("Cache-Control", "no-store");
    return c.json(await selectionJson(ctx, phone.id));
  });

  // Picked on the phone after the parent PIN: it already applies, so the server records it.
  app.put("/ios-selection", limit, async (c) => {
    const phone = c.get("phone");
    if (!canPickApps(phone, "phone")) return c.json(notSupported("phone"), 409);
    const { selection } = await body(c, iosSelectionInput);
    return c.json(await saveIosSelection(ctx, phone, selection, "phone", null));
  });
}

/** The parent's side, for a phone in one of the parent's households (`requirePhone`). */
export function parentIosSelectionRoutes(app: Hono<ParentEnv>, ctx: Ctx, requirePhone: (c: Context<ParentEnv>) => Promise<Phone>) {
  app.get("/phones/:pid/ios-selection", async (c) => {
    const phone = await requirePhone(c);
    if (phone.platform !== "ios") throw new HTTPException(404, { message: "not found" });
    c.header("Cache-Control", "no-store");
    return c.json(await selectionJson(ctx, phone.id));
  });

  app.put("/phones/:pid/ios-selection", limit, async (c) => {
    const phone = await requirePhone(c);
    if (!canPickApps(phone, "parent")) return c.json(notSupported("parent"), 409);
    const { selection } = await body(c, iosSelectionInput);
    return c.json(await saveIosSelection(ctx, phone, selection, "parent", c.get("user").id));
  });
}
