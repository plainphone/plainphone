// SPDX-License-Identifier: Apache-2.0
// The new-parent onboarding walk, driven by web/scripts/onboarding-walk.sh (docs/testing.md#onboarding-walk).
// Each run is a new parent: plainphone.org → "Get started" → sign-in link from the log mail provider →
// household → a child's phone in the Add phone flow → setup QR → a simulated phone redeems the
// token over the device API, syncs and reports status → the dashboard shows it with its health →
// the parent changes the daily time limit → the phone's /device/rules has the new limit.
// Runs in English and Danish at 390 and 1280 px. Fails on a broken step, a console error, a failed
// request the walk did not expect, or a missing translation. Steps slower than 2 s are reported.
// Screenshots and walk.json go to OUT. Addresses are @example.invalid, names are made up.
import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { da } from "../../packages/i18n/src/da.ts";
import { en } from "../../packages/i18n/src/en.ts";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const decodeQr = require("jsqr");
const { SITE_URL, WEB_URL, SERVER_LOG, OUT } = process.env;
const EXTRA = "android.app.extra.";
const SLOW_MS = 2000;
const LANGS = { en: { m: en, site: "/", locale: "en-GB" }, da: { m: da, site: "/da/", locale: "da-DK" } };
const WIDTHS = (process.env.WIDTHS ?? "390,1280").split(",").map(Number);
const only = process.env.LANGS?.split(",") ?? Object.keys(LANGS);

const results = [];
const browser = await chromium.launch();
try {
  for (const lang of only) for (const width of WIDTHS) results.push(await walk(lang, width));
} finally {
  await browser.close();
}
writeFileSync(join(OUT, "walk.json"), JSON.stringify(results, null, 2));
let failed = false;
for (const r of results) {
  console.log(`\n== ${r.run}: ${r.error ? `FAILED at "${r.step}": ${r.error}` : "ok"}`);
  for (const s of r.steps) console.log(`  ${s.ms > SLOW_MS ? "SLOW" : "    "} ${String(s.ms).padStart(6)} ms  ${s.name}`);
  for (const p of r.problems) console.log(`  problem: ${p}`);
  const notes = Map.groupBy(r.notes ?? [], (x) => x);
  for (const [note, all] of notes) console.log(`  note: ${all.length > 1 ? `${all.length}× ` : ""}${note}`);
  if (r.error || r.problems.length) failed = true;
}
process.exit(failed ? 1 : 0);

async function walk(lang, width) {
  const { m, site, locale } = LANGS[lang];
  const t = (key, params = {}) => m[key].replace(/\{(\w+)\}/g, (_, k) => String(params[k]));
  const run = `${lang}-${width}`;
  const r = { run, steps: [], problems: [], screenshots: [], step: "start" };
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale, timezoneId: "Europe/Copenhagen" });
  // Nothing leaves the machine. The site's links to the hosted dashboard open the local one.
  await ctx.route(/^https?:\/\/(?!127\.0\.0\.1[:/])/, (route) => {
    const url = route.request().url();
    if (url.startsWith("https://app.plainphone.org/")) {
      return route.fulfill({ status: 302, headers: { location: url.replace("https://app.plainphone.org", WEB_URL) } });
    }
    return route.abort();
  });
  const page = await ctx.newPage();
  let signedIn = false;
  // Before sign-in the dashboard asks /api/me whether a session exists; 401 is the answer "no", and
  // Chrome logs every 4xx resource as a console error. Noted, not a failure.
  const expected = (path, status) => !signedIn && path === "/api/me" && status === 401;
  r.notes = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const at = msg.location()?.url ?? "";
    const line = `console error on ${new URL(page.url()).pathname}: ${msg.text()}${at ? ` (${at})` : ""}`;
    if (at.startsWith(WEB_URL) && expected(new URL(at).pathname, 401) && msg.text().includes("401")) r.notes.push(line);
    else r.problems.push(line);
  });
  page.on("pageerror", (e) => r.problems.push(`page error on ${new URL(page.url()).pathname}: ${e.message}`));
  page.on("response", (res) => {
    if (res.status() >= 400 && res.url().startsWith(WEB_URL)) {
      const path = new URL(res.url()).pathname;
      (expected(path, res.status()) ? r.notes : r.problems).push(`${res.request().method()} ${path} → ${res.status()}`);
    }
  });
  // A request with no answer at all (refused, reset, empty). The page cancelling its own request
  // (net::ERR_ABORTED, e.g. on navigation) is noted, not a failure.
  page.on("requestfailed", (req) => {
    if (!req.url().startsWith(WEB_URL)) return;
    const error = req.failure()?.errorText ?? "failed";
    const line = `${req.method()} ${new URL(req.url()).pathname} → ${error}`;
    (error === "net::ERR_ABORTED" ? r.notes : r.problems).push(line);
  });
  let n = 0;
  const snap = async (name) => {
    const file = join(OUT, `${run}-${String(++n).padStart(2, "0")}-${name}.png`);
    await page.screenshot({ path: file, fullPage: true });
    r.screenshots.push(file);
    // A layout break at this width: something wider than the window.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 0) r.problems.push(`${name}: the page is ${overflow} px wider than the window`);
    // A key that leaked into the page instead of its text (a missing translation).
    const text = await page.locator("body").innerText();
    const keys = text.match(/\b[a-z]+(?:\.[a-z][A-Za-z]+)+\b/g)?.filter((k) => k in en);
    if (keys?.length) r.problems.push(`${name}: untranslated keys ${keys.join(", ")}`);
  };
  const step = async (name, fn) => {
    r.step = name;
    const t0 = Date.now();
    const out = await fn();
    r.steps.push({ name, ms: Date.now() - t0 });
    return out;
  };
  const main = page.locator("main");
  const email = `parent-${lang}-${width}-${randomBytes(4).toString("hex")}@example.invalid`;
  const child = lang === "da" ? "Testbarn Ea" : "Test Child Sam";

  try {
    await step("site loads", () => page.goto(`${SITE_URL}${site}`));
    await snap("site");
    await step("Get started → sign-in page", async () => {
      await page.getByRole("link", { name: lang === "da" ? "Kom i gang" : "Get started" }).first().click();
      await page.waitForURL(`${WEB_URL}/**`);
      await page.getByRole("heading", { name: t("login.title") }).waitFor();
    });
    await snap("login");

    await step("ask for a sign-in link", async () => {
      await page.getByLabel(t("login.email")).fill(email);
      await page.getByRole("button", { name: t("login.submit") }).click();
      await page.getByRole("heading", { name: t("login.sentTitle") }).waitFor();
    });
    await snap("link-sent");

    const link = await step("sign-in mail arrives (log provider)", () => mailLink(email));
    await step("open the sign-in link", async () => {
      await page.goto(link);
      await page.getByRole("heading", { name: t("phones.emptyTitle") }).waitFor();
      signedIn = true;
    });
    await snap("phones-empty");

    await step("household page", async () => {
      await page.getByRole("link", { name: t("nav.household") }).first().click();
      await page.getByRole("heading", { name: t("house.title") }).waitFor();
      await main.getByText(email).first().waitFor();
    });
    await snap("household");

    await step("Add phone → new or in use?", async () => {
      await page.getByRole("link", { name: t("nav.phones") }).first().click();
      await main.getByRole("link", { name: t("phones.add") }).first().click();
      await page.getByRole("heading", { name: t("add.modeTitle") }).waitFor();
    });
    await snap("add-mode");
    await step("choose a new phone (strong mode)", async () => {
      await main.getByRole("button", { name: t("add.modeStrong") }).click();
      await page.getByRole("heading", { name: t("add.whoTitle") }).waitFor();
    });
    await step("add the child", async () => {
      await main.getByRole("radio", { name: t("profile.child") }).check();
      await main.getByLabel(t("pair.name")).fill(child);
      await snap("add-who");
      await main.getByRole("button", { name: t("add.next") }).click();
      await page.getByRole("heading", { name: t("age.setupTitle", { name: child }) }).waitFor();
    });
    await step("pick the 10 to 11 preset", async () => {
      await main.getByRole("radio", { name: t("age.preset.10-11") }).check();
      await snap("add-age");
      await main.getByRole("button", { name: t("age.continue") }).click();
      await page.getByRole("heading", { name: t("age.agreement.title") }).waitFor();
    });
    await snap("add-agreement");
    await step("skip the family agreement", async () => {
      await main.getByRole("button", { name: t("age.skip") }).click();
      await page.getByRole("heading", { name: t("add.pinTitle") }).waitFor();
    });
    await step("choose the parent PIN", async () => {
      await main.getByLabel(t("add.pin"), { exact: true }).fill("482916");
      await main.getByLabel(t("add.pinAgain"), { exact: true }).fill("482916");
      await snap("add-pin");
    });
    const enrolled = await step("make the setup QR code", async () => {
      const res = page.waitForResponse((x) => x.url().endsWith("/api/phones/enroll") && x.request().method() === "POST");
      await main.getByRole("button", { name: t("add.makeQr") }).click();
      const body = await (await res).json();
      await page.getByRole("img", { name: t("add.qrAlt") }).waitFor();
      return body;
    });
    await snap("add-qr");
    // The phone only knows what its camera reads: take the token and the server from the code itself.
    const { token, server } = await step("read the setup QR code", async () => {
      const payload = await readQr(main.getByRole("img", { name: t("add.qrAlt") }));
      const extras = payload[`${EXTRA}PROVISIONING_ADMIN_EXTRAS_BUNDLE`];
      const token = extras?.["plainphone.enroll"];
      if (!token?.startsWith("pp_e_")) throw new Error("the setup QR code has no setup token");
      if (token !== enrolled.enrollment?.token) throw new Error("the setup QR code has another token than the server issued");
      // Without plainphone.server_url the app uses its default, the hosted service (PolicyConfig.kt).
      const server = extras["plainphone.server_url"] ?? "https://app.plainphone.org";
      if (server !== WEB_URL) throw new Error(`the setup QR code sends the phone to ${server}, not this stack (${WEB_URL})`);
      return { token, server };
    });
    const device = (...args) => deviceRequest(server, ...args);

    // --- The phone, as the Android app talks to the server (docs/sync-api.md) ------------------
    const phone = await step("phone redeems the setup token", async () => {
      const res = await device("POST", "/api/device/enroll", null, {
        token, installId: randomBytes(16).toString("hex"), deviceInfo: { model: "Walk test phone", sdk: "34" },
      });
      if (res.status !== 200) throw new Error(`POST /device/enroll → ${res.status} ${JSON.stringify(res.json)}`);
      return res.json;
    });
    const rules1 = await step("phone fetches its rules", async () => {
      const res = await device("GET", "/api/device/rules", phone.deviceToken);
      if (res.status !== 200) throw new Error(`GET /device/rules → ${res.status}`);
      return res;
    });
    await step("phone reports its status", async () => {
      const res = await device("PUT", "/api/device/status", phone.deviceToken, {
        appVersion: "0.1.0", androidVersion: "14", batteryPct: 76, charging: false, deviceOwner: true, lockIntact: true,
        maintenance: false, failedPolicies: [], rulesEtag: rules1.etag, rulesAppliedAt: new Date().toISOString(),
        rulesReceiptConfirmed: true, dnsHost: rules1.json.dns?.host ?? null, mode: "strong",
      });
      if (res.status >= 300) throw new Error(`PUT /device/status → ${res.status} ${JSON.stringify(res.json)}`);
    });
    await step("dashboard notices the phone is connected", async () => {
      await page.getByRole("heading", { name: t("add.getStarted") }).waitFor({ timeout: 20_000 });
    });
    await snap("add-paired");

    await step("open the phone", async () => {
      await main.getByRole("link", { name: t("setup.open", { name: child }) }).click();
      await page.getByRole("heading", { name: child, level: 1 }).waitFor();
      await page.getByRole("heading", { name: t("health.title") }).waitFor();
      // The phone name comes first; settings for SOS and messages load below the rules.
      await main.getByRole("heading", { name: t("phone.rulesSafety") }).waitFor();
      const first = await main.locator("h1, h2, h3, summary").first().innerText();
      if (first !== child) throw new Error(`the phone page starts with "${first}", not the phone name`);
    });
    await page.waitForLoadState("networkidle");
    const health = await step("phone health is good", async () => {
      const text = await main.locator(".health-rows").innerText({ timeout: 5_000 });
      if (!text.includes(t("phone.lockIntact"))) throw new Error(`the health rows do not say the lock is intact: ${JSON.stringify(text)}`);
      for (const key of ["health.waitForReport", "health.reconnect", "health.fixLock"]) {
        if (text.includes(t(key))) throw new Error(`the health rows say "${t(key)}" after a fresh status report`);
      }
      const receipt = await main.locator(".rule-receipt").innerText({ timeout: 5_000 });
      if (!receipt.includes(m["receipt.appliedAt"].split("{time}")[0].trim())) {
        throw new Error(`the rule receipt does not say the rules are active: ${JSON.stringify(receipt)}`);
      }
      return text;
    });
    r.health = health;
    await snap("phone");

    const before = minutesOf(rules1.json);
    await step("change the daily time limit", async () => {
      await main.getByRole("link", { name: t("phone.time") }).first().click();
      await page.getByRole("heading", { name: t("time.totalTitle") }).waitFor();
      await main.locator("#total-min").selectOption("60");
      await snap("time-before-save");
      const res = page.waitForResponse((x) => x.url().includes("/time-limits/total") && x.request().method() === "PUT");
      await main.getByRole("button", { name: t("app.save") }).click();
      if ((await res).status() >= 300) throw new Error(`saving the limit → ${(await res).status()}`);
      await main.getByText(t("time.totalSaved")).first().waitFor();
    });
    await snap("time-saved");
    const rules2 = await step("phone's /rules has the new limit", async () => {
      const res = await device("GET", "/api/device/rules", phone.deviceToken, undefined, rules1.etag);
      if (res.status !== 200) throw new Error(`GET /device/rules after the change → ${res.status}, expected a new document`);
      return res;
    });
    r.limit = { before, after: minutesOf(rules2.json) };
    if (r.limit.after !== 60) throw new Error(`the phone's total limit is ${r.limit.after}, expected 60 (was ${before})`);
    r.step = "done";
  } catch (err) {
    r.error = err.message.split("\n")[0];
    await snap("failure").catch(() => {});
  } finally {
    await ctx.close();
  }
  return r;
}

/** The newest sign-in link the log mail provider printed for this address. */
async function mailLink(email) {
  for (let i = 0; i < 100; i++) {
    const log = readFileSync(SERVER_LOG, "utf8");
    const mail = log.split(`--- mail to ${email}:`).at(-1);
    const link = log.includes(`--- mail to ${email}:`) && mail.match(/https?:\/\/\S+\/auth\/callback#token=\S+/)?.[0];
    if (link) return link;
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("no sign-in mail in the server log");
}

/** The JSON in a rendered QR code (an SVG on the page), drawn onto a canvas and decoded with jsQR. */
async function readQr(img) {
  const { width, height, data } = await img.evaluate(async (svg) => {
    const scale = 2;
    const [, , w, h] = svg.getAttribute("viewBox").split(" ").map(Number);
    const copy = svg.cloneNode(true);
    copy.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    copy.setAttribute("width", String(w * scale));
    copy.setAttribute("height", String(h * scale));
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = w * scale;
    canvas.height = h * scale;
    const g = canvas.getContext("2d");
    g.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: Array.from(g.getImageData(0, 0, canvas.width, canvas.height).data) };
  });
  const code = decodeQr(Uint8ClampedArray.from(data), width, height, { inversionAttempts: "dontInvert" });
  if (!code) throw new Error("the setup QR code could not be read");
  return JSON.parse(code.data);
}

/** A request as the phone app makes it, to the server the setup QR code named. */
async function deviceRequest(server, method, path, token, body, etag) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  if (etag) headers["if-none-match"] = etag;
  const res = await fetch(`${server}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  return { status: res.status, etag: res.headers.get("etag"), json: text ? JSON.parse(text) : null };
}

/** The total daily limit in a rules document, wherever the walk finds it. */
function minutesOf(rules) {
  const total = rules?.timeLimits?.total ?? rules?.timeLimits?.find?.((l) => l.packageName === "*" || l.total);
  return total?.minutes ?? null;
}
