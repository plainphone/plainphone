// SPDX-License-Identifier: Apache-2.0
// Dev-only: regenerates the real screenshots on the front page (`pnpm site:screenshots` in the repo root).
//   1. Android: the Robolectric test SiteScreenshotTest renders the home screen, the stop screen and
//      "What can my parents see?" (fictional child, fixed dates) in five languages, light and dark.
//   2. Web: the Vite dev server serves web/screenshots/site.html, which renders the real dashboard
//      components with fixtures. Playwright shoots them. No network, no production data.
//   3. WebP at 1x and 2x into site/src/img/, plus manifest.json with the 1x size of every picture.
// Needs Java and the Android SDK (step 1), playwright (NODE_PATH) and ImageMagick with WebP.
//   NODE_PATH=<dir with playwright> node tools/site-screenshots.mjs [--skip-android] [--skip-web]
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const root = resolve(here, "../..");
const out = join(root, "site/src/img");
const tmp = join(root, "site/.screenshots-tmp");
const androidShots = join(root, "android/app/build/site-screenshots");
const langs = ["en", "da", "sv", "nb", "de"];
const schemes = ["light", "dark"];
const skipAndroid = process.argv.includes("--skip-android");
const skipWeb = process.argv.includes("--skip-web");

const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed (${r.status})`);
};

/** 1x CSS width of each picture. Phones are 240 px wide, the dashboard 480 px. */
const PHONE_W = 240;
const DASH_W = 480;
mkdirSync(out, { recursive: true });
rmSync(tmp, { recursive: true, force: true });
mkdirSync(tmp, { recursive: true });

if (!skipAndroid) {
  rmSync(androidShots, { recursive: true, force: true });
  run("./gradlew", ["--no-daemon", "--no-build-cache", "--max-workers=2", "cleanTestGithubDebugUnitTest", "testGithubDebugUnitTest", "--tests", "org.plainphone.app.SiteScreenshotTest"], { cwd: join(root, "android") });
}

const dashboards = [["dashboard", "switches"], ["requests", "requests"]];
if (!skipWeb) {
  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const port = 20000 + Math.floor(Math.random() * 20000);
  const vite = spawn("pnpm", ["exec", "vite", "--port", String(port), "--strictPort", "--host", "127.0.0.1"], { cwd: join(root, "web"), stdio: "ignore" });
  try {
    const base = `http://127.0.0.1:${port}/screenshots/site.html`;
    for (let i = 0; ; i++) {
      if (await fetch(base).then((r) => r.ok, () => false)) break;
      if (i > 120) throw new Error("the Vite dev server did not start");
      await new Promise((r) => setTimeout(r, 500));
    }
    const browser = await chromium.launch();
    for (const scheme of schemes) {
      for (const scale of [1, 2]) {
        const ctx = await browser.newContext({ viewport: { width: DASH_W, height: 900 }, deviceScaleFactor: scale, colorScheme: scheme, locale: "en", timezoneId: "Europe/Copenhagen" });
        const page = await ctx.newPage();
        for (const [name, scene] of dashboards) {
          for (const lang of langs) {
            await page.goto(`${base}?scene=${scene}&lang=${lang}`, { waitUntil: "networkidle" });
            await page.evaluate(() => document.fonts.ready);
            await page.locator("#shot").screenshot({ path: join(tmp, `${name}-${lang}-${scheme}-${scale}x.png`) });
          }
        }
        await ctx.close();
      }
    }
    await browser.close();
  } finally {
    vite.kill();
  }
}

const identify = (file) => {
  const r = spawnSync("magick", ["identify", "-format", "%w %h", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`identify ${file}: ${r.stderr}`);
  return r.stdout.trim().split(" ").map(Number);
};
const webp = (src, dest, width) =>
  run("magick", [src, "-resize", `${width}x`, "-strip", "-define", "webp:method=6", "-define", "webp:sharp-yuv=true", "-quality", "82", dest]);

const manifest = {};
const names = [...dashboards.map(([n]) => n), "home", "blocked", "sharing"];
for (const name of names) {
  manifest[name] = {};
  for (const lang of langs) {
    for (const scheme of schemes) {
      const phone = !dashboards.some(([n]) => n === name);
      const size = [];
      for (const scale of [1, 2]) {
        const dest = join(out, `${name}-${lang}-${scheme}-${scale}x.webp`);
        if (phone) {
          webp(join(androidShots, `${name}-${lang}-${scheme}.png`), dest, PHONE_W * scale);
        } else {
          const src = join(tmp, `${name}-${lang}-${scheme}-${scale}x.png`);
          webp(src, dest, DASH_W * scale);
        }
        size.push(identify(dest));
      }
      const [[w1, h1], [w2, h2]] = size;
      if (w2 !== 2 * w1 || Math.abs(h2 - 2 * h1) > 1) throw new Error(`${name}-${lang}-${scheme}: 1x and 2x differ (${w1}x${h1}, ${w2}x${h2})`);
      const prev = manifest[name][lang];
      if (prev && (prev.width !== w1 || prev.height !== h1)) throw new Error(`${name}-${lang}: light and dark differ in size`);
      manifest[name][lang] = { width: w1, height: h1 };
    }
  }
}
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
rmSync(tmp, { recursive: true, force: true });
const files = readdirSync(out).filter((f) => f.endsWith(".webp"));
const bytes = files.reduce((n, f) => n + readFileSync(join(out, f)).length, 0);
console.log(`${files.length} images, ${(bytes / 1024).toFixed(0)} KiB in ${out}`);
