// SPDX-License-Identifier: Apache-2.0
//
// The Swift side's view of the iPhone rules document (docs/ios/architecture.md, "The Swift Expo
// module"). ios/Tests/Fixtures/ios-rules.json is what the Swift unit tests decode; this test checks
// that a real document from this server still has every field of that fixture with the same JSON
// type, so a rename here fails on Linux before the macOS job runs.
// Regenerate after a deliberate change: UPDATE_IOS_FIXTURE=1 pnpm vitest run test/ios-contract.test.ts
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { phones, schedules, timeBonuses, timeLimits } from "../src/db/schema.js";
import { localDate, TOTAL } from "../src/services/limits.js";
import { Client, signIn, useHarness } from "./harness.js";

const h = useHarness();
const FIXTURE = fileURLToPath(new URL("../../ios/Tests/Fixtures/ios-rules.json", import.meta.url));
const FIXTURE_PHONE_ID = "00000000-0000-4000-8000-000000000001";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Every path of `fixture` with its JSON type; arrays by their first element. */
function shape(value: Json, path = "$", out: Record<string, string> = {}): Record<string, string> {
  const kind = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  out[path] = kind;
  if (Array.isArray(value) && value.length > 0) shape(value[0]!, `${path}[]`, out);
  else if (kind === "object") for (const [k, v] of Object.entries(value as Record<string, Json>)) shape(v, `${path}.${k}`, out);
  return out;
}

async function liveDocument() {
  h.ctx.cfg.IOS_PAIRING_ENABLED = true;
  const parent = await signIn(h, "parent@example.org");
  const device = new Client(h);
  const start = await device.post("/api/device/pairings", { platform: "ios", profile: "child", deviceInfo: { model: "iPhone" } });
  const claim = await parent.post("/api/phones/claim", { code: start.json.code, name: "Test iPhone", profile: "child" });
  const poll = await device.get(`/api/device/pairings/${start.json.pairingId}`, { "x-poll-secret": start.json.pollSecret });
  device.token = poll.json.deviceToken;
  const phoneId = claim.json.id as string;
  const [phone] = await h.ctx.db.select().from(phones).where(eq(phones.id, phoneId));
  const today = localDate(phone!.timezone, h.clock.now);
  await h.ctx.db.insert(schedules).values([
    { phoneId, kind: "school", days: [1, 2, 3, 4, 5], startMinute: 480, endMinute: 870, allowedPackages: [] },
    { phoneId, kind: "bedtime", days: [1, 2, 3, 4, 5, 6, 7], startMinute: 1260, endMinute: 420, allowedPackages: [] },
  ]);
  await h.ctx.db.insert(timeLimits).values({ phoneId, packageName: TOTAL, minutes: 90 });
  await h.ctx.db.insert(timeBonuses).values({ phoneId, packageName: TOTAL, day: today, minutes: 15 });
  expect((await device.put("/api/device/ios-selection", { selection: Buffer.alloc(60, 7).toString("base64") })).status).toBe(200);
  const r = await device.get("/api/device/rules");
  expect(r.status).toBe(200);
  return { doc: r.json as { [key: string]: Json }, phoneId };
}

describe("iOS rules fixture for the Swift tests", () => {
  it("matches the shape of a real iPhone rules document", async () => {
    const { doc, phoneId } = await liveDocument();
    if (process.env.UPDATE_IOS_FIXTURE === "1") {
      // Fixed ids and host, so a regenerated fixture only differs where the document changed.
      const ids = [phoneId, ...((doc.schedules as { id: string }[]).map((s) => s.id))];
      let text = JSON.stringify(doc, null, 2);
      ids.forEach((id, i) => { text = text.replaceAll(id, i === 0 ? FIXTURE_PHONE_ID : `00000000-0000-4000-8000-00000000010${i}`); });
      const host = (doc.dns as { host: string }).host;
      text = text.replaceAll(host, "fixture.dns.plainphone.org").replaceAll(doc.dnsRevision as string, "fixture-dns-revision");
      writeFileSync(FIXTURE, `${text}\n`);
    }
    const fixture = JSON.parse(readFileSync(FIXTURE, "utf8")) as Json;
    const live = shape(doc);
    for (const [path, kind] of Object.entries(shape(fixture))) {
      expect(live[path], `${path} is in the Swift fixture but not in the server's document`).toBeDefined();
      // A nullable field may be null on one side only.
      if (kind !== "null" && live[path] !== "null") expect(live[path], path).toBe(kind);
    }
  });
});
