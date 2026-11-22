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
const recoveryStatus = {
  en: "<strong>Phone status</strong> shows reset protection is on",
  da: "<strong>Telefonens status</strong>, at den seneste rapport viser, at beskyttelse mod nulstilling er slået til",
  sv: "att telefonens senaste rapport visar att återställningsskyddet är på",
  nb: "at den siste rapporten fra telefonen viser at tilbakestillingsbeskyttelsen er på",
  de: "ob der letzte Bericht des Handys zeigt, dass der Schutz vor dem Zurücksetzen aktiv ist",
};
const lookupRoute = "apps/";
const routes = ["", "setup/", "privacy/", "why/", "help/", lookupRoute, "press/"];
const pagePaths = routes.map((page) =>
  Object.fromEntries(locales.map((lang) => [
    lang,
    `/${lang === "en" ? "" : `${lang}/`}${lang === "da" && page === "why/" ? "hvorfor/" : page}`,
  ])),
);

// Published on purpose but unlinked and noindex until the organisations have agreed (content/giving.mjs).
// They are checked here separately: no canonical or hreflang, never in the sitemap, never linked from another page.
const givingPaths = locales.map((lang) => `/${lang === "en" ? "" : `${lang}/`}giving/`);

const files = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
const html = files(dist).filter((f) => f.endsWith(".html"));
if (html.length !== locales.length * (pagePaths.length + 1) + 1) errors.push("Expected every localized page and one 404 page");
const headers = readFileSync(join(dist, "_headers"), "utf8");
const csp = headers.match(/^  Content-Security-Policy: (.+)$/m)?.[1] ?? "";
const directives = new Map();
for (const line of csp.split(";").filter((line) => line.trim())) {
  const [name, ...values] = line.trim().split(/\s+/);
  if (directives.has(name)) errors.push(`_headers: duplicate CSP directive ${name}`);
  directives.set(name, values);
}
const cspHashes = new Set((directives.get("style-src") ?? []).map((value) => value.match(/^'sha256-([A-Za-z0-9+/]+=)'$/)?.[1]));
const searchPath = "/app-search.mjs";
const searchFile = join(dist, searchPath);
const searchHash = existsSync(searchFile) ? createHash("sha256").update(readFileSync(searchFile)).digest("base64") : null;
if (!searchHash || directives.get("script-src")?.join(" ") !== `'sha256-${searchHash}'`) {
  errors.push("_headers: script-src must pin only the published search module");
}
const seenHashes = new Set();
for (const directive of ["default-src", "style-src-attr", "frame-ancestors", "base-uri", "form-action"]) {
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
  const isGiving = givingPaths.some((path) => target(path) === file);
  if (isGiving) {
    if (!src.includes('<meta name="robots" content="noindex">')) errors.push(`${name}: giving page must be noindex`);
    if (/<link rel="(?:canonical|alternate)"/.test(src)) errors.push(`${name}: giving page must have no canonical or alternate links`);
  } else if (name !== "404.html" && givingPaths.some((path) => src.includes(`"${path}"`) || src.includes(`"https://plainphone.org${path}"`))) {
    errors.push(`${name}: links to an unpublished giving page`);
  }
  const scripts = [...src.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
  const searchAttrs = ` type="module" src="${searchPath}" integrity="sha256-${searchHash}"`;
  let searchCount = 0;
  for (const [, attrs, value] of scripts) {
    if (searchHash && attrs === searchAttrs && value === "") {
      searchCount++;
      continue;
    }
    try {
      if (attrs !== ' type="application/ld+json"') throw new Error();
      JSON.parse(value);
    } catch {
      errors.push(`${name}: unexpected script or invalid JSON-LD`);
    }
  }
  if ((src.match(/<script\b/gi) ?? []).length !== scripts.length) errors.push(`${name}: malformed script`);
  if (searchCount !== 1) errors.push(`${name}: expected exactly one site script`);
  // Hash the exact published styles, and check CSS requests even if CSP would block them.
  const styles = [...src.matchAll(/<style>([\s\S]*?)<\/style>/gi)];
  if (styles.length !== 1 || (src.match(/<style\b/gi) ?? []).length !== 1 || !styles[0][1].trim()) {
    errors.push(`${name}: expected one non-empty inline stylesheet`);
  }
  for (const [, css] of styles) {
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
    if (attributes.get("target")?.toLowerCase() === "_blank" && !/(^|\s)noopener(\s|$)/i.test(attributes.get("rel") ?? "")) {
      errors.push(`${relative(dist, file)}: target="_blank" link without rel="noopener"`);
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
  if (name !== "404.html" && !isGiving) {
    const ownLang = src.match(/<html lang="([a-z]{2})">/)?.[1];
    const counterparts = pagePaths.find((paths) => target(paths[ownLang] ?? "/") === file);
    if (!locales.includes(ownLang) || !counterparts) {
      errors.push(`${name}: unexpected page for language ${ownLang}`);
      continue;
    }
    if (counterparts[ownLang].endsWith("/help/") && recoveryStatus[ownLang]) {
      const recovery = src.match(/<section id="recovery"[\s\S]*?<\/section>/)?.[0];
      if (!recovery?.includes(recoveryStatus[ownLang])) {
        errors.push(`${name}: recovery instructions must point to the phone's reported reset-protection status`);
      }
    }
    const xDefault = `<link rel="alternate" hreflang="x-default" href="https://plainphone.org${counterparts.en}">`;
    if (!src.includes(xDefault)) errors.push(`${name}: missing English x-default alternate`);
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
        // The header, the small-screen menu and the footer each list the languages.
        if (!switches.length || switches.some((s) => s[1] !== path)) {
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

if (/giving/.test(readFileSync(join(dist, "sitemap.xml"), "utf8"))) errors.push("sitemap.xml: giving pages must not be listed");
if (/giving/.test(readFileSync(join(dist, "robots.txt"), "utf8"))) errors.push("robots.txt: giving pages must not be listed");
for (const hash of cspHashes) {
  if (!seenHashes.has(hash)) errors.push(`_headers: unused style hash ${hash}`);
}


// Front page pictures (pnpm site:screenshots): every language shows every picture, light and dark, 1x and 2x,
// as real WebP files whose size matches the width and height in the HTML, with alt text.
const shotNames = ["dashboard", "requests", "home", "blocked", "sharing"];
const webpSize = (file) => {
  const b = readFileSync(file);
  if (b.length < 30 || b.toString("latin1", 0, 4) !== "RIFF" || b.toString("latin1", 8, 12) !== "WEBP") return null;
  const kind = b.toString("latin1", 12, 16);
  if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === "VP8L") {
    const bits = b.readUInt32LE(21);
    return [(bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1];
  }
  if (kind === "VP8X") return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
  return null;
};
for (const lang of locales) {
  const file = join(dist, lang === "en" ? "index.html" : `${lang}/index.html`);
  const page = readFileSync(file, "utf8");
  for (const name of shotNames) {
    const tag = page.match(new RegExp(`<img src="/img/${name}-${lang}-light-1x\\.webp"[^>]*>`))?.[0];
    if (!tag) {
      errors.push(`${lang}: front page has no ${name} picture`);
      continue;
    }
    const width = Number(tag.match(/ width="(\d+)"/)?.[1]);
    const height = Number(tag.match(/ height="(\d+)"/)?.[1]);
    if (!/ alt="[^"]{20,}"/.test(tag)) errors.push(`${lang}: ${name} picture needs descriptive alt text`);
    for (const scheme of ["light", "dark"]) {
      for (const scale of [1, 2]) {
        const img = join(dist, "img", `${name}-${lang}-${scheme}-${scale}x.webp`);
        if (!existsSync(img)) {
          errors.push(`${lang}: missing image img/${name}-${lang}-${scheme}-${scale}x.webp (run pnpm site:screenshots)`);
          continue;
        }
        const size = webpSize(img);
        if (!size) errors.push(`${lang}: ${name}-${lang}-${scheme}-${scale}x.webp is not a WebP file`);
        else if (size[0] !== width * scale || Math.abs(size[1] - height * scale) > 1) {
          errors.push(`${lang}: ${name}-${lang}-${scheme}-${scale}x.webp is ${size.join("x")}, the page says ${width}x${height} at ${scale}x`);
        }
      }
    }
  }
}
// Press kit: every language links the zip, and the zip holds the logos, share images and screenshots.
const kitZip = join(dist, "press-kit", "plainphone-press-kit.zip");
if (!existsSync(kitZip)) errors.push("press-kit: missing plainphone-press-kit.zip");
else {
  const names = zipNames(readFileSync(kitZip));
  const expected = [
    "logo/plainphone-logo.svg", "logo/plainphone-logo.png", "logo/plainphone-logo-dark.svg", "logo/plainphone-logo-dark.png",
    "logo/plainphone-app-icon.svg", "logo/plainphone-app-icon.png",
    ...locales.map((lang) => `share-image/plainphone-${lang}.png`),
    ...locales.flatMap((lang) => shotNames.flatMap((shot) => ["light", "dark"].map((s) => `screenshots/${lang}/${shot}-${s}.webp`))),
  ];
  for (const name of expected) if (!names.includes(name)) errors.push(`press-kit zip: missing ${name}`);
  for (const lang of locales) {
    const page = readFileSync(target(pagePaths.at(-1)[lang]), "utf8");
    if (!page.includes('href="/press-kit/plainphone-press-kit.zip" download')) errors.push(`${lang}: press page does not link the zip`);
  }
}
function zipNames(buf) {
  const end = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) return [];
  const names = [];
  let at = buf.readUInt32LE(end + 16);
  for (let i = 0; i < buf.readUInt16LE(end + 10); i++) {
    const length = buf.readUInt16LE(at + 28);
    names.push(buf.toString("utf8", at + 46, at + 46 + length));
    at += 46 + length + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return names;
}

if (external) {
  for (const url of externalLinks) {
    try {
      let res = await fetch(url, { method: "HEAD", redirect: "follow" });
      if ([403, 404, 405].includes(res.status)) res = await fetch(url, { redirect: "follow" });
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
