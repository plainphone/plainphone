// SPDX-License-Identifier: Apache-2.0
// Checks the built site: every internal link, asset and #anchor resolves, every
// page has lang, title, description and one h1, and no page loads anything
// from another origin. With --external, external links are fetched as well.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));
const external = process.argv.includes("--external");
const errors = [];
const externalLinks = new Set();
const ogLocales = { en: "en_GB", da: "da_DK", sv: "sv_SE", nb: "nb_NO", de: "de_DE" };
const locales = Object.keys(ogLocales);

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
const html = files(dist).filter((f) => f.endsWith(".html"));
if (html.length !== locales.length * 4 + 1) errors.push("Expected four pages per locale and one 404 page");
const headers = readFileSync(join(dist, "_headers"), "utf8");
const cspHashes = new Set([...headers.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]));

function resolve(from, url) {
  const u = new URL(url, "https://plainphone.org/" + relative(dist, from));
  return u;
}
function target(pathname) {
  const p = join(dist, decodeURIComponent(pathname));
  if (pathname.endsWith("/")) return join(p, "index.html");
  return p;
}

for (const file of html) {
  const src = readFileSync(file, "utf8");
  const name = relative(dist, file);
  const ids = new Set([...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  if (!/<html lang="[a-z]{2}">/.test(src)) errors.push(`${name}: missing <html lang>`);
  if (!/<title>[^<]{10,}<\/title>/.test(src)) errors.push(`${name}: missing <title>`);
  if (!/<meta name="description" content="[^"]{50,}">/.test(src)) errors.push(`${name}: missing description`);
  if ((src.match(/<h1[\s>]/g) || []).length !== 1) errors.push(`${name}: needs exactly one <h1>`);
  if (/<script[\s>]/.test(src)) errors.push(`${name}: contains a <script>`);
  // Every inline <style> must be allowed by a hash in the CSP, or the page renders unstyled.
  for (const [, css] of src.matchAll(/<style>([\s\S]*?)<\/style>/g)) {
    const h = createHash("sha256").update(css).digest("base64");
    if (!cspHashes.has(h)) errors.push(`${name}: inline <style> hash ${h} is not in the _headers CSP`);
  }
  const dupes = [...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]).filter((v, i, a) => a.indexOf(v) !== i);
  if (dupes.length) errors.push(`${name}: duplicate ids ${dupes.join(", ")}`);

  for (const [, attr, url] of src.matchAll(/\s(href|src|content)="([^"]+)"/g)) {
    if (attr === "content" && !/^https?:\/\//.test(url)) continue;
    if (url.startsWith("mailto:")) continue;
    const u = resolve(file, url);
    if (u.origin !== "https://plainphone.org") {
      if (attr === "src") errors.push(`${name}: loads ${url} from another origin`);
      externalLinks.add(u.href.replace(/#.*$/, ""));
      continue;
    }
    if (attr === "content" && !/\.(png|svg)$/.test(u.pathname)) continue; // canonical URLs in meta
    const t = target(u.pathname);
    if (!existsSync(t)) {
      errors.push(`${name}: broken link ${url}`);
      continue;
    }
    if (u.hash) {
      const tIds = t === file ? ids : new Set([...readFileSync(t, "utf8").matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
      if (!tIds.has(u.hash.slice(1))) errors.push(`${name}: missing anchor ${url}`);
    }
  }
  if (name !== "404.html") {
    const ownLang = src.match(/<html lang="([a-z]{2})">/)?.[1];
    const expectedOg = ownLang && `<meta property="og:locale" content="${ogLocales[ownLang]}">`;
    if (!expectedOg || !src.includes(expectedOg)) errors.push(`${name}: missing Open Graph locale`);
    if (!src.includes(`<meta property="og:image" content="https://plainphone.org/og-${ownLang}.png">`)) {
      errors.push(`${name}: missing localized Open Graph image`);
    }
    for (const lang of locales) {
      const alternate = src.match(new RegExp(`<link rel="alternate" hreflang="${lang}" href="([^"]+)"`))?.[1];
      if (!alternate) {
        errors.push(`${name}: missing ${lang} alternate`);
        continue;
      }
      const path = new URL(alternate).pathname;
      const counterpart = target(path);
      if (existsSync(counterpart) && !readFileSync(counterpart, "utf8").includes(`<html lang="${lang}">`)) {
        errors.push(`${name}: ${path} is not in ${lang}`);
      }
      if (lang !== ownLang) {
        if (!src.includes(`<meta property="og:locale:alternate" content="${ogLocales[lang]}">`)) {
          errors.push(`${name}: missing Open Graph alternate for ${lang}`);
        }
        if (!src.includes(`<a href="${path}" hreflang="${lang}" lang="${lang}">`)) {
          errors.push(`${name}: missing language switch to ${path}`);
        }
      }
    }
  }
  // Every <link rel=canonical/alternate> must point at a page that exists.
  for (const [, url] of src.matchAll(/<link rel="(?:canonical|alternate)"[^>]*href="([^"]+)"/g)) {
    const u = new URL(url);
    if (!existsSync(target(u.pathname))) errors.push(`${name}: canonical/alternate ${url} does not exist`);
  }
}

if (external) {
  for (const url of externalLinks) {
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow" });
      if (res.status === 405 || res.status === 403) res = await fetch(url, { redirect: "follow" });
      if (!res.ok) errors.push(`external ${url}: ${res.status}`);
    } catch (e) {
      errors.push(`external ${url}: ${e.message}`);
    }
  }
}

if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(`OK: ${html.length} pages, ${externalLinks.size} external links${external ? " checked" : " (not fetched)"}`);
