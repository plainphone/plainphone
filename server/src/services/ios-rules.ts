// SPDX-License-Identifier: Apache-2.0
//
// The rules document an iPhone fetches (docs/ios/architecture.md, "iOS rules document"). It is the
// Android document cut down to what an iPhone can act on: every key is on an allowlist, tied to
// the capability it needs, and left out when the phone's tier cannot do that at all. Android
// mechanisms (package names, Device Owner settings, FCM, private DNS, Google accounts) never
// reach an iPhone; its apps come as the opaque selection the parent or the phone picked.

import { createHash } from "node:crypto";
import type { Capabilities, Feature, Tier } from "../lib/capabilities.js";
import { eq } from "drizzle-orm";
import { iosSelections, type IOS_SELECTION_SOURCES } from "../db/schema.js";
import type { Ctx } from "./context.js";
import { TOTAL } from "./limits.js";

/** "core": always sent. A feature: sent unless the tier's support for it is "no". */
type Gate = "core" | Feature;

/** Top-level keys of the Android document an iPhone gets, each behind the capability it needs. */
export const IOS_RULE_KEYS = {
  phoneId: "core",
  allowServerMove: "core",
  move: "core",
  profile: "core",
  timezone: "core",
  language: "core",
  rulesRevision: "core",
  pollSeconds: "core",
  pendingChanges: "core",
  changeReceiptsEnabled: "receipts",
  healthBoardEnabled: "health",
  weeklySummaryEnabled: "weeklySummary",
  silentBedtime: "bedtimeSilence",
  pinApprovalEnabled: "pinApproval",
  timeLimits: "timeLimits",
  contacts: "contacts",
  sos: "sos",
  inbox: "core",
  ageAgreement: "core",
  selfEmergency: "selfKeys",
  schedules: "schoolTime",
  dns: "webFilter",
  dnsRevision: "webFilter",
  fallbackDnsHost: "webFilter",
  location: "location",
  ring: "ring",
  checkIn: "checkin",
  release: "release",
  supportEnabled: "helpLines",
  releaseWarningsEnabled: "release",
  askMoreTimeEnabled: "moreTime",
  limitWarningEnabled: "limitWarning",
} as const satisfies Record<string, Gate>;

/**
 * Keys of the Android document that are Android mechanisms and never reach an iPhone, whatever
 * the capability map says. Listed so a test notices a new Android key that nobody placed.
 */
export const ANDROID_ONLY_RULE_KEYS = [
  "apps", // package names; an iPhone gets `iosApps`
  "modes", // modes carry package lists; iPhone modes come in phase 2
  "mode", // strong or light
  "pushProvider",
  "unifiedPushAvailable",
  "fcmValidationKey",
  "suggestDeviceContacts",
  "lightContactRestriction",
  "selfScheduleContacts",
  "lockSystemLanguage",
  "settings",
  "home",
  "update",
  "appUpdates",
  "resetProtection",
] as const;

export interface IosSelectionMeta {
  selection: string;
  source: (typeof IOS_SELECTION_SOURCES)[number];
  updatedAt: Date;
}

type Doc = Record<string, unknown>;

/** A schedule without its Android package list. */
function iosSchedules(schedules: unknown): unknown {
  if (!Array.isArray(schedules)) return [];
  return schedules.map((s: Record<string, unknown>) => ({ id: s.id, kind: s.kind, days: s.days, start: s.start, end: s.end }));
}

/** The whole-phone limit and its bonuses; per-app limits need app tokens (phase 2). */
function iosTimeLimits(limits: unknown): unknown {
  const l = limits as { total?: unknown; bonuses?: { packageName: string; date: string; minutes: number }[] };
  return {
    total: l.total ?? null,
    // A whole-phone bonus carries the TOTAL sentinel; per-app bonuses wait for app tokens.
    bonuses: (l.bonuses ?? []).filter((b) => b.packageName === TOTAL).map(({ date, minutes }) => ({ date, minutes })),
  };
}

/** The DNS filter without Android's method and private-DNS state. */
function iosDns(dns: unknown): unknown {
  const d = dns as { host: unknown; ready: unknown; blockedCategories: unknown };
  return { host: d.host, ready: d.ready, blockedCategories: d.blockedCategories };
}

/**
 * Pending changes keep their kind and timing only (docs/ios/architecture.md): many ops carry
 * package names, which mean nothing on an iPhone, so the contents wait until the Swift side asks.
 */
function iosPending(pending: unknown): unknown {
  if (!Array.isArray(pending)) return [];
  return pending.map((c: { id: string; op: { type: string }; keyType: unknown; effectiveAt: unknown }) => ({
    id: c.id, type: c.op.type, keyType: c.keyType, effectiveAt: c.effectiveAt,
  }));
}

/** Project the Android rules document onto an iPhone of `tier`. */
export function iosRulesDocument(doc: Doc, tier: Tier, caps: Capabilities, openMode: boolean, selection: IosSelectionMeta | null): Doc {
  const out: Doc = {};
  for (const [key, gate] of Object.entries(IOS_RULE_KEYS) as [string, Gate][]) {
    if (!(key in doc)) continue;
    if (gate !== "core" && caps[gate] === "no") continue;
    const value = doc[key];
    out[key] =
      key === "schedules" ? iosSchedules(value)
      : key === "timeLimits" ? iosTimeLimits(value)
      : key === "dns" ? iosDns(value)
      : key === "pendingChanges" ? iosPending(value)
      : value;
  }
  return {
    ...out,
    platform: "ios",
    tier,
    capabilities: caps,
    // Apps on an iPhone: one selection, opaque to the server. In open mode it is the block list,
    // otherwise the apps allowed besides Apple's own. The phone fetches the bytes from
    // GET /device/ios-selection when `revision` changes.
    iosApps: {
      open: openMode,
      selection: selection
        ? {
          revision: createHash("sha256").update(selection.selection).digest("base64url").slice(0, 22),
          source: selection.source,
          updatedAt: selection.updatedAt.toISOString(),
        }
        : null,
    },
  };
}

export async function loadIosSelection(db: Ctx["db"], phoneId: string): Promise<IosSelectionMeta | null> {
  const [row] = await db.select({ selection: iosSelections.selection, source: iosSelections.source, updatedAt: iosSelections.updatedAt })
    .from(iosSelections).where(eq(iosSelections.phoneId, phoneId));
  return row ?? null;
}
