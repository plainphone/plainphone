// SPDX-License-Identifier: Apache-2.0
// Dev-only: captures the parent app's web build with synthetic fixtures (no server, no real data).
//   cd parent-app && pnpm exec expo export --platform web --output-dir <dist>
//   NODE_PATH=<dir with playwright> node capture-expo.mjs <dist> <out-dir> <label>
// The web build uses the system font: the brand fonts are linked into the native apps only.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { extname, join } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [dist, out, label] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".ttf": "font/ttf", ".ico": "image/x-icon", ".json": "application/json" };
const server = createServer((req, res) => {
  const p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  let file = join(dist, p);
  if (!existsSync(file) || p.endsWith("/")) file = join(dist, "index.html");
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
}).listen(0);
const port = server.address().port;

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

async function openPage(browser, scheme, signedIn) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: "da-DK", timezoneId: "Europe/Copenhagen" });
  await ctx.addInitScript((s) => {
    sessionStorage.setItem("pp.locale", "da");
    if (s) sessionStorage.setItem("pp.session", JSON.stringify({ server: "https://app.plainphone.org", token: "pp_s_demo" }));
  }, signedIn);
  await ctx.route("https://app.plainphone.org/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (body) => route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
    if (p === "/api/me") return json({ user: { id: "u1", email: "parent@example.org", locale: "da" }, households: [{ id: "h1", name: "Demo", role: "owner" }], mailEnabled: true });
    if (p === "/api/phones") return json({ phones: [PHONE] });
    if (p === "/api/notifications") return json({ webPushEnabled: false, webPushPublicKey: null, offlineAlertHours: 24, subscriptions: [], mutedPhoneIds: [] });
    if (p === `/api/phones/${PHONE.id}`) return json(PHONE);
    return json({ events: [], callbackNumber: null, changes: [], requests: [] });
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(FAKE_NOW) });
  return { ctx, page };
}

const PAGES = [
  ["expo-login", "/login", false],
  ["expo-phones", "/", true],
  ["expo-phone", `/phones/${PHONE.id}`, true],
  ["expo-settings", "/settings", true],
];

try {
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    for (const [name, path, signedIn] of PAGES) {
      const { ctx, page } = await openPage(browser, scheme, signedIn);
      page.on("pageerror", (e) => console.error(name, e.message));
      await page.goto(`http://localhost:${port}${path}`);
      await page.waitForTimeout(2500);
      await page.screenshot({ path: join(out, `${name}-${scheme}-${label}.png`) });
      await ctx.close();
    }
  }
  await browser.close();
  console.log(`Screenshots in ${out}`);
} finally {
  server.close();
}
