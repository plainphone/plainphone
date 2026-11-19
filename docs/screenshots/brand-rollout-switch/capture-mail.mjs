// SPDX-License-Identifier: Apache-2.0
// Dev-only: renders every server mail template in light and dark with fixture data.
//   cd server && NODE_PATH=<dir with playwright> pnpm exec tsx ../docs/screenshots/brand-rollout-switch/capture-mail.mjs \
//     <mail-templates.ts> <logo-dir> <out-dir> <label>
// Requests for the hosted logo are answered from <logo-dir> on disk, so nothing is fetched from the network.
import { mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");
const [templates, logoDir, out, label] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const m = await import(pathToFileURL(resolve(templates)).href);

const PUBLIC = "https://app.example.org";
const mails = {
  login: m.loginMail("parent@example.org", "da", PUBLIC, `${PUBLIC}/auth/callback#token=demo`, 15),
  invite: m.inviteMail("parent@example.org", "en", PUBLIC, `${PUBLIC}/invite#demo`, "parent", 7),
  approval: m.approvalRequestMail("parent@example.org", "da", PUBLIC, "Sam Demo"),
  protection: m.phoneAlertMail("parent@example.org", "en", PUBLIC, { kind: "protection", phoneId: "p1", phoneName: "Sam Demo", reason: "lock" }),
  offline: m.phoneAlertMail("parent@example.org", "da", PUBLIC, { kind: "offline", phoneId: "p1", phoneName: "Sam Demo", hours: 24, lastSeen: "i går kl. 18.04" }),
  sos: m.sosMail("parent@example.org", "da", PUBLIC, "p1", "Sam Demo har trykket SOS", "Sam Demo har trykket SOS kl. 14.32. Ring til telefonen."),
};

const browser = await chromium.launch();
try {
  for (const scheme of ["light", "dark"]) {
    const ctx = await browser.newContext({ viewport: { width: 600, height: 900 }, deviceScaleFactor: 2, colorScheme: scheme });
    // Old templates load plainphone.org/mail/logo*, new ones <PUBLIC_URL>/mail/lockup*.
    await ctx.route(/\/mail\/[^/]+\.png$/, (route) =>
      route.fulfill({ contentType: "image/png", body: readFileSync(join(logoDir, basename(new URL(route.request().url()).pathname))) }),
    );
    const page = await ctx.newPage();
    for (const [name, mail] of Object.entries(mails)) {
      const html = mail.html;
      await page.setContent(html, { waitUntil: "load" });
      await page.screenshot({ path: join(out, `mail-${name}-${scheme}-${label}.png`), fullPage: true });
    }
    await ctx.close();
  }
} finally {
  await browser.close();
}
console.log(`Mail screenshots in ${out}`);
