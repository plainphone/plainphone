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
const pagePaths = ["", "setup/", "privacy/", "why/"].map((page) =>
  Object.fromEntries(locales.map((lang) => [
    lang,
    `/${lang === "en" ? "" : `${lang}/`}${lang === "da" && page === "why/" ? "hvorfor/" : page}`,
  ])),
);

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
const html = files(dist).filter((f) => f.endsWith(".html"));
if (html.length !== locales.length * 4 + 1) errors.push("Expected four pages per locale and one 404 page");
const headers = readFileSync(join(dist, "_headers"), "utf8");
const csp = headers.match(/^  Content-Security-Policy: (.+)$/m)?.[1] ?? "";
const directives = new Map();
for (const line of csp.split(";").filter((line) => line.trim())) {
  const [name, ...values] = line.trim().split(/\s+/);
  if (directives.has(name)) errors.push(`_headers: duplicate CSP directive ${name}`);
  directives.set(name, values);
}
const cspHashes = new Set((directives.get("style-src") ?? []).map((value) => value.match(/^'sha256-([A-Za-z0-9+/]+=)'$/)?.[1]));
const seenHashes = new Set();
for (const directive of ["default-src", "script-src", "style-src-attr", "frame-ancestors", "base-uri", "form-action"]) {
  if (directives.get(directive)?.join(" ") !== "'none'") errors.push(`_headers: expected ${directive} 'none'`);
}
for (const directive of ["img-src", "font-src", "connect-src"]) {
  if (directives.get(directive)?.join(" ") !== "'self'") errors.push(`_headers: expected ${directive} 'self'`);
}
if (directives.size !== 10) errors.push("_headers: unexpected CSP directive");
if (!cspHashes.size || cspHashes.has(undefined) || csp.includes("unsafe-")) {
  errors.push("_headers: style-src must contain only SHA-256 hashes");
}

function resolve(from, url) {
  const u = new URL(url, "https://plainphone.org/" + relative(dist, from));
  return u;
}
function target(pathname) {
  const p = join(dist, decodeURIComponent(pathname));
  if (pathname.endsWith("/")) return join(p, "index.html");
  return p;
}

function checkResource(file, url) {
  if (url.startsWith("#")) return;
  const name = relative(dist, file);
  // Build output uses root-relative asset URLs. Reject HTML entities and
  // backslashes before parsing so browser URL normalization cannot change them.
  if (!/^\/(?!\/)[A-Za-z0-9._/-]+$/.test(url)) {
    errors.push(`${name}: resource must use a same-origin asset path: ${url}`);
  } else if (!existsSync(target(resolve(file, url).pathname))) {
    errors.push(`${name}: missing resource ${url}`);
  }
}

for (const file of html) {
  const src = readFileSync(file, "utf8");
  const name = relative(dist, file);
  const ids = new Set([...src.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  if (!/<html lang="[a-z]{2}">/.test(src)) errors.push(`${name}: missing <html lang>`);
  if (!/<title>[^<]{10,}<\/title>/.test(src)) errors.push(`${name}: missing <title>`);
  if (!/<meta name="description" content="[^"]{50,}">/.test(src)) errors.push(`${name}: missing description`);
  if ((src.match(/<h1[\s>]/g) || []).length !== 1) errors.push(`${name}: needs exactly one <h1>`);
  const scripts = [...src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  for (const [, attrs, value] of scripts) {
    try {
      if (attrs !== ' type="application/ld+json"') throw new Error();
      JSON.parse(value);
    } catch {
      errors.push(`${name}: only valid inline JSON-LD is allowed in script elements`);
    }
  }
  if ((src.match(/<script\b/gi) ?? []).length !== scripts.length) errors.push(`${name}: malformed script`);
  // Hash the exact published styles, and check CSS requests even if CSP would block them.
  for (const [, css] of src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    const h = createHash("sha256").update(css).digest("base64");
    seenHashes.add(h);
    if (!cspHashes.has(h)) errors.push(`${name}: inline <style> hash ${h} is not in the _headers CSP`);
    // The stylesheet uses literal asset paths and one escaped minus glyph.
    if (/@import\b|image-set\(|\\/i.test(css.replaceAll('"\\2212"', ''))) {
      errors.push(`${name}: unsupported CSS resource syntax`);
    }
    for (const [, resource] of css.matchAll(/url\(\s*("[^"]*"|'[^']*'|[^)]+)\)/gi)) {
      checkResource(file, resource.trim().replace(/^(["'])(.*)\1$/, "$2"));
    }
  }
  for (const [, name, attrs] of src.matchAll(/<([a-z][\w:-]*)\b((?:"[^"]*"|'[^']*'|[^'"<>])*)>/gi)) {
    const tag = name.toLowerCase();
    const attributes = new Map([...attrs.matchAll(/([^\s=/"'<>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+)))?/g)]
      .map(([, key, double, single, bare]) => [key.toLowerCase(), double ?? single ?? bare ?? ""]));
    if (/^(iframe|frame|embed|object|base|audio|video|track|portal)$/i.test(tag) ||
        [...attributes.keys()].some((key) => key === "style" || key.startsWith("on") || key === "ping" || key === "srcdoc") ||
        (tag === "meta" && attributes.has("http-equiv"))) {
      errors.push(`${relative(dist, file)}: disallowed element or attribute on <${tag}>`);
    }
    for (const key of ["src", "poster", "background", "data", "manifest", "xlink:href"]) {
      if (attributes.has(key)) checkResource(file, attributes.get(key));
    }
    for (const key of ["srcset", "imagesrcset"]) {
      if (!attributes.has(key)) continue;
      for (const candidate of attributes.get(key).split(",")) checkResource(file, candidate.trim().split(/\s+/)[0]);
    }
    if (attributes.has("href") && tag !== "a") {
      const rel = attributes.get("rel") ?? "";
      if (tag !== "link" || !["canonical", "alternate"].includes(rel)) {
        checkResource(file, attributes.get("href"));
        if (tag === "link" && !["icon", "apple-touch-icon", "preload"].includes(rel)) {
          errors.push(`${relative(dist, file)}: unsupported link relation ${rel}`);
        }
      }
    }
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
    const counterparts = pagePaths.find((paths) => target(paths[ownLang] ?? "/") === file);
    if (!locales.includes(ownLang) || !counterparts) {
      errors.push(`${name}: unexpected page for language ${ownLang}`);
      continue;
    }
    const expectedOg = ownLang && `<meta property="og:locale" content="${ogLocales[ownLang]}">`;
    if (!expectedOg || !src.includes(expectedOg)) errors.push(`${name}: missing Open Graph locale`);
    if (!src.includes(`<meta property="og:image" content="https://plainphone.org/og-${ownLang}.png">`)) {
      errors.push(`${name}: missing localized Open Graph image`);
    }
    for (const lang of locales) {
      const path = counterparts[lang];
      const alternates = [...src.matchAll(new RegExp(`<link rel="alternate" hreflang="${lang}" href="([^"]+)"`, "g"))];
      if (alternates.length !== 1 || alternates[0][1] !== `https://plainphone.org${path}`) {
        errors.push(`${name}: expected ${lang} alternate to ${path}`);
      }
      if (lang !== ownLang) {
        if (!src.includes(`<meta property="og:locale:alternate" content="${ogLocales[lang]}">`)) {
          errors.push(`${name}: missing Open Graph alternate for ${lang}`);
        }
        const switches = [...src.matchAll(new RegExp(`<a href="([^"]+)" hreflang="${lang}" lang="${lang}">`, "g"))];
        if (switches.length !== 1 || switches[0][1] !== path) {
          errors.push(`${name}: expected ${lang} language switch to ${path}`);
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

for (const hash of cspHashes) {
  if (!seenHashes.has(hash)) errors.push(`_headers: unused style hash ${hash}`);
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
