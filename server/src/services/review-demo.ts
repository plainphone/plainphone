// SPDX-License-Identifier: Apache-2.0
//
// The review account's demo phone (docs/store-review.md). A store reviewer has the parent app but
// no child's phone, so the review household gets a simulated one. It talks to this server through
// the same API a real phone uses (in process, no network), so every screen shows data shaped
// exactly like a real phone's. Everything is invented: the name, the contacts' numbers (the
// 555-01xx range kept for fiction) and a position in a public park.
import { and, eq, inArray, sql } from "drizzle-orm";
import { householdMembers, phones } from "../db/schema.js";
import { randomToken, sha256 } from "../lib/crypto.js";
import { DEVICE_PREFIX } from "../routes/device.js";
import type { Ctx } from "./context.js";
import { TOTAL } from "./limits.js";

/** Calls this server's own API in process (`app.request` in app.ts). */
export type LocalRequest = (path: string, init: RequestInit) => Response | Promise<Response>;

/** Marks the simulated phone in `phones.device_info`, so it is refreshed and never mistaken for a real one. */
export const DEMO_DEVICE_INFO = { manufacturer: "Plainphone", model: "Demo phone", demo: "review" } as const;

export const DEMO_PHONE_NAME = "Alex";

const DEMO_APPS = [
  { packageName: "com.google.android.dialer", label: "Phone", core: true },
  { packageName: "com.google.android.apps.messaging", label: "Messages", core: true },
  { packageName: "com.google.android.GoogleCamera", label: "Camera", core: true },
  { packageName: "com.google.android.deskclock", label: "Clock", core: true },
  { packageName: "com.google.android.calculator", label: "Calculator", core: false },
  { packageName: "com.duolingo", label: "Duolingo", core: false },
  { packageName: "com.spotify.music", label: "Spotify", core: false },
  { packageName: "com.google.android.youtube", label: "YouTube", core: false },
  { packageName: "com.mojang.minecraftpe", label: "Minecraft", core: false },
];

/** The app the demo child asks for, so the reviewer finds a request waiting. */
const DEMO_REQUEST = "com.mojang.minecraftpe";

const DEMO_CONTACTS = [
  { name: "Mum", number: "+12025550147" },
  { name: "Dad", number: "+12025550186" },
];

/** Kongens Have, a public park in Copenhagen. */
const DEMO_POSITION = { lat: 55.6857, lon: 12.5776, accuracyM: 25 };

/**
 * Makes sure the review household has its demo phone and that the phone looks alive: paired on
 * first sign-in, then checked in again on every later one. A household that has a real phone
 * paired is left alone.
 */
export async function ensureReviewDemo(ctx: Ctx, request: LocalRequest, userId: string, sessionToken: string) {
  const owned = ctx.db.select({ id: householdMembers.householdId }).from(householdMembers)
    .where(and(eq(householdMembers.userId, userId), eq(householdMembers.role, "owner")));
  const existing = await ctx.db.select({ id: phones.id, demo: sql<string | null>`${phones.deviceInfo}->>'demo'` })
    .from(phones).where(inArray(phones.householdId, owned));
  if (existing.some((p) => p.demo !== "review")) return;

  const api = client(request);
  const parent = api(sessionToken);
  let phoneId = existing[0]?.id;
  let device: ReturnType<typeof api>;
  if (!phoneId) {
    const anonymous = api(null);
    const start = await anonymous.call("POST", "/api/device/pairings", { mode: "light", deviceInfo: DEMO_DEVICE_INFO });
    const claim = await parent.call("POST", "/api/phones/claim", { code: start.code, name: DEMO_PHONE_NAME, profile: "child" });
    phoneId = claim.id as string;
    const poll = await anonymous.call("GET", `/api/device/pairings/${start.pairingId}`, undefined, { "x-poll-secret": start.pollSecret });
    device = api(poll.deviceToken as string);
    await device.call("GET", "/api/device/rules");
  } else {
    // The phone's own token is never stored, only its hash: each sign-in gives it a fresh one.
    const token = randomToken(DEVICE_PREFIX);
    await ctx.db.update(phones).set({ deviceTokenHash: sha256(token) }).where(eq(phones.id, phoneId));
    device = api(token);
  }
  // Sent again on every sign-in, so a first sign-in that failed halfway is completed later. The
  // app list is replaced as a whole; contacts are only added to a phone that has none.
  await device.call("PUT", "/api/device/apps", { apps: DEMO_APPS });
  const contacts = await parent.call("GET", `/api/phones/${phoneId}/contacts`);
  if (!contacts?.contacts?.length) {
    for (const contact of DEMO_CONTACTS) await parent.call("POST", `/api/phones/${phoneId}/contacts`, contact);
  }
  await checkIn(ctx, device, parent, phoneId);
}

async function checkIn(ctx: Ctx, device: Api, parent: Api, phoneId: string) {
  const now = ctx.now();
  await device.call("GET", "/api/device/rules");
  await device.call("PUT", "/api/device/status", {
    appVersion: "demo",
    androidVersion: "15",
    batteryPct: 76,
    charging: false,
    deviceOwner: false,
    lockIntact: true,
    maintenance: false,
    mode: "light",
    protections: { deviceAdmin: true, accessibility: true, usageAccess: true, vpn: true, phoneRole: true, smsRole: true },
    filterMethod: "vpn",
    filterWorking: true,
    webFilterActive: true,
    failedPolicies: [],
    rulesEtag: null,
    rulesAppliedAt: now.toISOString(),
    dnsHost: null,
    timeUsed: { [TOTAL]: 47, "com.duolingo": 18, "com.spotify.music": 29 },
  });
  // Answered with 409 once the reviewer has allowed the app: then there is nothing to ask for.
  await device.call("POST", "/api/device/requests", { kind: "app", packageName: DEMO_REQUEST }, {}, [409]);
  // A Find the phone answered at once, so the location page has a position to show.
  const locate = await parent.call("POST", `/api/phones/${phoneId}/locate`, {}, {}, [409]);
  if (locate?.requestedAt) {
    await device.call("PUT", "/api/device/location", {
      ...DEMO_POSITION,
      recordedAt: now.toISOString(),
      purpose: `find:${new Date(locate.requestedAt as string).getTime()}`,
    });
  }
}

type Api = { call: (method: string, path: string, body?: unknown, headers?: Record<string, string>, tolerate?: number[]) => Promise<any> };

function client(request: LocalRequest) {
  return (token: string | null): Api => ({
    async call(method, path, body, headers = {}, tolerate = []) {
      const res = await request(path, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      if (tolerate.includes(res.status)) return null;
      // Only the method, path and status: answers can hold the review account's data.
      if (!res.ok) throw new Error(`demo phone: ${method} ${path.replace(/[0-9a-f-]{36}/g, ":id")} answered ${res.status}`);
      return text ? JSON.parse(text) : null;
    },
  });
}
