// SPDX-License-Identifier: Apache-2.0
// Dev-only: captures the setup surfaces with synthetic fixtures (no server, no real data).
//   NODE_PATH=<dir with playwright> node capture.mjs <checkout> <out-dir> <label>
// Starts the dashboard with Vite and serves the built site from <checkout>/site/dist (build it first).
// The dashboard API is answered by fixtures through request interception.
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, extname } from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [checkout, out, label] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const WEB_PORT = 5300 + Math.floor(Math.random() * 200);
const SITE_PORT = WEB_PORT + 300;

const vite = spawn("pnpm", ["exec", "vite", "--port", String(WEB_PORT), "--strictPort"], { cwd: join(checkout, "web"), stdio: "ignore" });
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2" };
const dist = join(checkout, "site/dist");
const site = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname);
  if (p.endsWith("/")) p += "index.html";
  const file = join(dist, p);
  if (!existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(readFileSync(file));
}).listen(SITE_PORT);

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return; } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`${url} did not start`);
}

const PHONE = { id: "demo-phone", name: "Sam Demo", mode: "light", profile: "child", timezone: "Europe/Copenhagen", pairedAt: null };
const provisioning = {
  serverUrl: "https://plainphone.example.org",
  adminComponent: "org.plainphone.app/.PlainphoneAdminReceiver",
  downloadUrl: "https://plainphone.example.org/download/android",
  signatureChecksum: "demo-checksum",
  dnsHost: "dns.example.org",
};
// Fixed so both runs draw the same QR code.
const FAKE_NOW = Date.parse("2026-11-19T10:00:00+01:00");
const TOKEN = "pp_e_3q2-7wEvR1q8aZ0sLx9Ywg";

async function openPage(browser, scheme, expiresInMs) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: "da-DK", timezoneId: "Europe/Copenhagen" });
  await ctx.addInitScript(() => localStorage.setItem("pp.locale", "da"));
  await ctx.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const method = route.request().method();
    const json = (body, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname === "/api/me") return json({ user: { id: "u1", email: "parent@example.org", locale: "da" }, households: [{ id: "h1", name: "Demo", role: "owner" }], mailEnabled: true });
    if (url.pathname === "/api/phones/enroll" || url.pathname.endsWith("/enrollment")) {
      return json({ phone: PHONE, enrollment: { token: TOKEN, expiresAt: new Date(FAKE_NOW + expiresInMs).toISOString() }, provisioning }, 201);
    }
    if (url.pathname.startsWith("/api/phones/") && method === "GET") return json(PHONE);
    return json({}, 200);
  });
  const page = await ctx.newPage();
  await page.clock.install({ time: new Date(FAKE_NOW) });
  return { ctx, page };
}

const shot = (page, name, scheme) => page.screenshot({ path: join(out, `${label}-${name}-${scheme}.png`), fullPage: true });

try {
  await waitFor(`http://localhost:${WEB_PORT}/`);
  const browser = await chromium.launch();
  for (const scheme of ["light", "dark"]) {
    // 1. The first choice: new or in use.
    let { ctx, page } = await openPage(browser, scheme, 3_600_000);
    await page.goto(`http://localhost:${WEB_PORT}/add`);
    await page.waitForSelector(".choice");
    await shot(page, "web-add-choice", scheme);
    await ctx.close();

    // 2. The code, with a working phone to wait for.
    ({ ctx, page } = await openPage(browser, scheme, 3_600_000));
    await page.goto(`http://localhost:${WEB_PORT}/add?mode=light`);
    await page.fill('input[name="name"]', "Sam Demo");
    await page.click('button[type="submit"]');
    await page.waitForSelector(".qr");
    await shot(page, "web-setup-code", scheme);
    // Keyboard focus on the first control after the code.
    await page.keyboard.press("Tab");
    await shot(page, "web-setup-code-focus", scheme);
    await ctx.close();

    // 3. The code ran out.
    ({ ctx, page } = await openPage(browser, scheme, 3_000));
    await page.goto(`http://localhost:${WEB_PORT}/add?mode=light`);
    await page.fill('input[name="name"]', "Sam Demo");
    await page.click('button[type="submit"]');
    await page.waitForSelector(".qr");
    await page.clock.fastForward(5_000);
    await page.waitForSelector("[role=alert]");
    await shot(page, "web-setup-expired", scheme);
    await ctx.close();

    // 4. The public site's setup page.
    ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: scheme, locale: "da-DK" });
    page = await ctx.newPage();
    await page.goto(`http://localhost:${SITE_PORT}/da/setup/`, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(out, `${label}-site-setup-${scheme}.png`), clip: { x: 0, y: 0, width: 390, height: 1300 } });
    await ctx.close();
  }
  await browser.close();
  console.log(`Screenshots in ${out}`);
} finally {
  vite.kill();
  site.close();
}
