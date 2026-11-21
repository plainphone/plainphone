// SPDX-License-Identifier: Apache-2.0
//
// GET /api/events: server-sent events for the dashboard and the parent app while they are open
// (docs/live-updates.md). Mounted by parentRoutes, behind its session check.

import type { Hono } from "hono";
import type { LiveHub } from "../services/live-hub.js";
import type { ParentEnv } from "./parent.js";

/** Long enough for any id the hub hands out; anything longer is ignored. */
const MAX_EVENT_ID = 40;

export function liveEventRoutes(app: Hono<ParentEnv>, hub: LiveHub) {
  app.get("/events", async (c) => {
    // EventSource sends Last-Event-ID itself when it reconnects; a client that makes a new
    // EventSource (after a backoff, or in the native app) passes it in the query instead.
    const raw = c.req.header("last-event-id") ?? c.req.query("lastEventId");
    const lastEventId = raw && raw.length <= MAX_EVENT_ID ? raw : undefined;
    const opened = await hub.open(c.get("user").id, c.get("sessionId"), lastEventId);
    if (!opened.ok) {
      c.header("Retry-After", "30");
      return c.json({ error: opened.error }, opened.status);
    }
    return new Response(opened.stream, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        // no-transform keeps proxies from compressing or holding back the stream.
        "Cache-Control": "no-cache, no-store, no-transform",
        Connection: "keep-alive",
        // nginx (and proxies that honour it) must not buffer the stream.
        "X-Accel-Buffering": "no",
      },
    });
  });
}
