// SPDX-License-Identifier: Apache-2.0
// Dev-only: captures the web dashboard with synthetic fixtures (no server, no real data).
//   NODE_PATH=<dir with playwright> node capture-web.mjs <checkout> <out-dir> <label>
// Starts the dashboard with Vite; the API is answered by fixtures through request interception.
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [checkout, out, label] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const WEB_PORT = 5300 + Math.floor(Math.random() * 400);
const vite = spawn("pnpm", ["exec", "vite", "--port", String(WEB_PORT), "--strictPort"], { cwd: join(checkout, "web"), stdio: "ignore" });

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not start`);
}

const FAKE_NOW = Date.parse("2026-11-19T10:00:00+01:00");
const PHONE = {
  id: "demo-phone", name: "Sam Demo", profile: "child", mode: "strong", timezone: "Europe/Copenhagen",
  locationEnabled: true, pairedAt: "2026-11-01T10:00:00Z", releaseRequestedAt: null, lastSeenAt: "2026-11-19T08:58:00Z",
  dnsHost: "demo.dns.example.org", dnsSynced: true, dnsReady: true, hasLocation: false,
  status: {
    appVersion: "1.0", batteryPct: 74, charging: false, deviceOwner: true, lockIntact: true, maintenance: false,
    failedPolicies: [], rulesEtag: null, rulesAppliedAt: "2026-11-19T08:58:00Z", dnsHost: null, reportedAt: "2026-11-19T08:58:00Z",
  },
  openRequests: 0, offlineAlertHours: null, offlineAlertHoursDefault: 24,
};
const KEYS = ["bluetooth", "wifi", "mobileNetworks", "roaming", "tethering", "nfc", "airplaneMode", "screenTimeout", "brightness", "volume", "wallpaper", "location", "camera", "screenCapture", "language"];
const settings = Object.fromEntries(KEYS.map((k) => [k, { mode: "free" }]));
settings.camera = { mode: "locked", value: false };
settings.roaming = { mode: "locked", value: false };

async function openPage(browser, scheme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: "da-DK", timezoneId: "Europe/Copenhagen" });
  await ctx.addInitScript(() => localStorage.setItem("pp.locale", "da"));
  await ctx.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/me") return json({ user: { id: "u1", email: "parent@example.org", locale: "da" }, households: [{ id: "h1", name: "Demo", role: "owner" }], mailEnabled: true });
    if (p === "/api/phones") return json({ phones: [PHONE] });
    if (p === "/api/notifications") return json({ webPushEnabled: false, webPushPublicKey: null, offlineAlertHours: 24, subscriptions: [], mutedPhoneIds: [] });
    if (p.endsWith("/settings")) return json({ settings });
    if (p.endsWith("/changes")) return json({ changes: [] });
    if (p.endsWith("/requests")) return json({ requests: [] });
    if (p === `/api/phones/${PHONE.id}`) return json(PHONE);
    return json({ events: [], callbackNumber: null, changes: [], requests: [] }, 200);
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(FAKE_NOW) });
  return { ctx, page };
}

const PAGES = [
  ["web-phones", "/"],
  ["web-phone", `/phones/${PHONE.id}`],
  ["web-phone-settings", `/phones/${PHONE.id}/settings`],
  ["web-settings", "/settings"],
  ["web-login", "/login"],
];

try {
  await waitFor(`http://localhost:${WEB_PORT}/`);
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    for (const [name, path] of PAGES) {
      const { ctx, page } = await openPage(browser, scheme);
      page.on("pageerror", (e) => console.error(name, e.stack.split("\n").slice(0,4).join(" / ")));
      await page.goto(`http://localhost:${WEB_PORT}${path}`);
      await page.waitForSelector("h1", { timeout: 8000 }).catch(() => console.error(name, "no h1"));
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(out, `${name}-${scheme}-${label}.png`), fullPage: true });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`Screenshots in ${out}`);
} finally {
  vite.kill();
}
