// SPDX-License-Identifier: Apache-2.0
// Builds the static plainphone.org site into dist/. No dependencies, no client JS.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import en from "./content/en.mjs";
import da from "./content/da.mjs";
import { figures } from "./figures.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");
const ORIGIN = "https://plainphone.org";
const GITHUB = "https://github.com/plainphone/plainphone";
const pages = [en, da];

const css = readFileSync(join(src, "style.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s*\n\s*/g, "")
  .replace(/\s*([{}:;,>])\s*/g, "$1")
  .replace(/;}/g, "}");
const cssHash = createHash("sha256").update(css).digest("base64");
const wordmark = readFileSync(join(src, "wordmark.svg"), "utf8")
  .trim()
  .replace("<svg ", '<svg class="wordmark" ')
  .replace(/\srole="img"/, "")
  .replace(/\saria-labelledby="[^"]*"><title[^>]*>[^<]*<\/title>/, ' aria-hidden="true" focusable="false">');
if (!wordmark.includes('aria-hidden="true"') || wordmark.includes("<title")) throw new Error("wordmark.svg: unexpected markup");

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const slug = (s) => s.toLowerCase().replace(/æ/g, "ae").replace(/ø/g, "o").replace(/å/g, "a").normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function head(
  t,
  {
    path,
    noindex = false,
    title = t.title,
    description = t.description,
    ogTitle = t.hero.title,
    alternates = pages.map((p) => ({ lang: p.lang, path: p.path })),
    xDefault = "/",
  },
) {
  const alt = alternates
    .map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${ORIGIN}${a.path}">`)
    .join("");
  return `<!doctype html>
<html lang="${t.lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
${noindex ? '<meta name="robots" content="noindex">' : `<link rel="canonical" href="${ORIGIN}${path}">${alt}<link rel="alternate" hreflang="x-default" href="${ORIGIN}${xDefault}">`}
<meta name="color-scheme" content="light dark">
<meta name="theme-color" content="#f3f5f2" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#172025" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/atkinson-hyperlegible-next.woff2" as="font" type="font/woff2" crossorigin>
<meta property="og:type" content="website">
<meta property="og:site_name" content="Plainphone">
<meta property="og:title" content="${esc(ogTitle)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${ORIGIN}${path}">
<meta property="og:image" content="${ORIGIN}/og-${t.lang}.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${esc(t.ogAlt)}">
<meta property="og:locale" content="${t.lang === "da" ? "da_DK" : "en_GB"}">
<meta property="og:locale:alternate" content="${t.lang === "da" ? "en_GB" : "da_DK"}">
<meta name="twitter:card" content="summary_large_image">
<style>${css}</style>
</head>`;
}

function header(t, switchHref) {
  const other = pages.find((p) => p.lang === t.nav.switchLang);
  return `<a class="skip" href="#main">${t.skip}</a>
<header class="top">
<a class="brand" href="${t.path}">${wordmark}<span class="sr">Plainphone</span></a>
<nav aria-label="${t.nav.label}">
<a href="${switchHref ?? other.path}" hreflang="${other.lang}" lang="${other.lang}">${t.nav.switchLabel}</a>
<a href="${GITHUB}">${t.nav.source}</a>
</nav>
</header>`;
}

function footer(t) {
  return `<footer class="foot">
<p>${t.footer.maintained}</p>
<p>${t.footer.setup}</p>
<p><a href="${t.why.path}">${t.why.h1}</a></p>
<p>${t.footer.privacy}</p>
<p>${t.footer.license}</p>
</footer>`;
}

function page(t) {
  const h = t.hero;
  const section = (id, title, body, cls = "") =>
    `<section class="block ${cls}" aria-labelledby="${id}"><h2 id="${id}">${title}</h2>${body}</section>`;

  const hero = `<section class="hero" aria-labelledby="hero-title">
<p class="status"><span>${t.status}</span></p>
<h1 id="hero-title">${h.title}</h1>
<p class="lead">${h.lead}</p>
<div class="ledger">
<ul class="stays" aria-label="${h.staysLabel}">${h.stays.map((s) => `<li>${s}</li>`).join("")}</ul>
<ul class="goes" aria-label="${h.goesLabel}">${h.goes.map((s) => `<li><del>${s}</del></li>`).join("")}</ul>
</div>
</section>`;

  const who = section(
    "who",
    t.who.title,
    `<p class="intro">${t.who.lead}</p><div class="paths">${t.who.paths
      .map((p) => `<article class="path" id="${p.id}"><h3>${p.title}</h3><p>${p.body}</p></article>`)
      .join("")}</div>`,
  );

  const how = section(
    "how",
    t.how.title,
    `<ol class="steps">${t.how.steps
      .map((s) => `<li><h3>${s.title}</h3><p>${s.body}</p></li>`)
      .join("")}</ol><p>${t.how.guide}</p><p class="note">${t.how.note}</p>
<p><a href="${t.why.path}">${t.why.h1}</a></p>`,
  );

  const c = t.compare;
  const compare = section(
    "compare",
    c.title,
    `<p class="intro">${c.lead}</p><div class="table-wrap" role="region" aria-labelledby="compare" tabindex="0"><table>
<caption class="sr">${c.caption}</caption>
<thead><tr><td></td>${c.cols.map((col, i) => `<th scope="col"${i === c.cols.length - 1 ? ' class="us"' : ""}>${col}</th>`).join("")}</tr></thead>
<tbody>${c.rows
      .map(
        ([label, ...cells]) =>
          `<tr><th scope="row">${label}</th>${cells
            .map((v, i) => `<td${i === cells.length - 1 ? ' class="us"' : ""}>${v}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody></table></div>`,
  );

  const phones = section("phones", t.phones.title, `<p>${t.phones.body}</p>`);

  const o = t.open;
  const open = section(
    "open",
    o.title,
    `${o.body.map((p) => `<p>${p}</p>`).join("")}<p>${o.follow}</p>
<p><a class="button" href="${GITHUB}">${o.github}</a></p>
<p class="note">${o.donate}</p>`,
  );

  const faq = section(
    "faq",
    t.faq.title,
    t.faq.items
      .map((it) => `<details id="${slug(it.q)}"><summary>${it.q}</summary><p>${it.a}</p></details>`)
      .join(""),
  );

  return `${head(t, { path: t.path })}
<body>
${header(t)}
<main id="main">
${hero}
${who}
${how}
${compare}
${phones}
${open}
${faq}
</main>
${footer(t)}
</body>
</html>
`;
}

function notFound() {
  const t = en;
  return `${head({ ...t, title: `${t.notFound.title}: Plainphone` }, { path: "/404", noindex: true })}
<body>
${header(t)}
<main id="main" class="hero">
<h1>${t.notFound.title}</h1>
<p class="lead">${t.notFound.body}</p>
<p><a href="/">${t.notFound.back}</a></p>
<p lang="da"><a href="/da/">${da.notFound.back}</a></p>
</main>
${footer(t)}
</body>
</html>
`;
}

function whyPage(t) {
  const p = t.why;
  const other = pages.find((x) => x.lang === t.nav.switchLang);
  return `${head(t, {
    path: p.path,
    title: p.h1,
    description: p.lead,
    ogTitle: p.h1,
    alternates: pages.map((x) => ({ lang: x.lang, path: x.why.path })),
    xDefault: pages[0].why.path,
  })}
<body>
${header(t, other.why.path)}
<main id="main" class="doc">
<h1>${p.h1}</h1>
<p class="lead">${p.lead}</p>
${p.sections.map(([title, body]) => `<section><h2>${title}</h2><p>${body}</p></section>`).join("\n")}
<section>
<h2>${p.sourcesTitle}</h2>
<ul>${p.sources.map(([label, url]) => `<li><a href="${esc(url)}">${label}</a></li>`).join("")}</ul>
</section>
</main>
${footer(t)}
</body>
</html>
`;
}

// The privacy policy: long-form text in content/*.mjs under `privacy`.
// A block is a string (paragraph), { list: [...] } or { table: { caption, cols, rows } }.
function privacyPage(t) {
  const p = t.privacy;
  const other = pages.find((x) => x.lang === t.nav.switchLang);
  const block = (b) => {
    if (typeof b === "string") return `<p>${b}</p>`;
    if (b.list) return `<ul>${b.list.map((li) => `<li>${li}</li>`).join("")}</ul>`;
    const { caption, cols, rows } = b.table;
    return `<div class="table-wrap" role="region" aria-label="${esc(caption)}" tabindex="0"><table>
<caption class="sr">${caption}</caption>
<thead><tr>${cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>
<tbody>${rows.map(([what, how]) => `<tr><th scope="row">${what}</th><td>${how}</td></tr>`).join("")}</tbody></table></div>`;
  };
  const section = (s) =>
    `<section aria-labelledby="${s.id}"><h2 id="${s.id}">${s.title}</h2>${s.body.map(block).join("")}</section>`;
  return `${head(t, {
    path: p.path,
    title: p.title,
    description: p.description,
    ogTitle: p.h1,
    alternates: pages.map((x) => ({ lang: x.lang, path: x.privacy.path })),
    xDefault: pages[0].privacy.path,
  })}
<body>
${header(t, other.privacy.path)}
<main id="main" class="doc">
<h1>${p.h1}</h1>
<p class="updated">${p.updated}</p>
<p class="lead">${p.lead}</p>
<p class="note">${p.status}</p>
<nav class="toc" aria-label="${p.tocLabel}"><ul>${p.sections.map((s) => `<li><a href="#${s.id}">${s.title}</a></li>`).join("")}</ul></nav>
<section class="short" aria-labelledby="short"><h2 id="short">${p.short.title}</h2>${block({ list: p.short.list })}</section>
${p.sections.map(section).join("\n")}
</main>
${footer(t)}
</body>
</html>
`;
}

function setupPage(t) {
  const p = t.setup;
  const other = pages.find((x) => x.lang === t.nav.switchLang);
  const drawings = figures({ ...p.drawing, alt: p.figs });
  const figure = (key) => drawings[key] ? `<figure class="shot">${drawings[key]}</figure>` : "";
  const tb = p.tested;
  return `${head(t, {
    path: p.path,
    title: p.title,
    description: p.description,
    ogTitle: p.h1,
    alternates: pages.map((x) => ({ lang: x.lang, path: x.setup.path })),
    xDefault: pages[0].setup.path,
  })}
<body>
${header(t, other.setup.path)}
<main id="main" class="doc setup">
<h1>${p.h1}</h1>
<p class="lead">${p.lead}</p>
<section aria-labelledby="phone-choice">
<h2 id="phone-choice">${p.question}</h2>
<div class="setup-paths">
  <a href="#strong"><strong>${p.strong}</strong><span>${p.strongHelp}</span></a>
  <a href="#light"><strong>${p.light}</strong><span>${p.lightHelp}</span></a>
</div>
</section>
<section aria-labelledby="strong"><h2 id="strong">${p.strongTitle}</h2>
<p>${p.start}</p>
<p><a class="button" href="https://app.plainphone.org/add?mode=strong">${p.startStrong}</a></p>
<ol class="guide">
${p.steps
  .map((st) => `<li><h3>${st.title}</h3>${st.body.map((b) => `<p>${b}</p>`).join("")}${figure(st.fig)}</li>`)
  .join("\n")}
</ol></section>
<section aria-labelledby="light"><h2 id="light">${p.lightTitle}</h2>
<p>${p.start}</p>
<p><a class="button" href="https://app.plainphone.org/add?mode=light">${p.startLight}</a></p>
<ol class="guide">
${p.lightSteps.map(([title, body, fig]) => `<li><h3>${title}</h3><p>${body}</p>${figure(fig)}</li>`).join("\n")}
</ol></section>
<section aria-labelledby="after"><h2 id="after">${p.nextTitle}</h2><p>${p.next}</p></section>
<section aria-labelledby="trouble"><h2 id="trouble">${p.troubleTitle}</h2><dl>${[...p.trouble, ...p.lightHelpItems]
    .map(([q, a]) => `<dt>${q}</dt><dd>${a}</dd>`)
    .join("")}</dl><p class="help">${p.help}</p></section>
<section aria-labelledby="tested"><h2 id="tested">${p.testedTitle}</h2><div class="table-wrap" role="region" aria-labelledby="tested" tabindex="0"><table>
<caption class="sr">${tb.caption}</caption>
<thead><tr>${tb.cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>
<tbody>${tb.rows.map(([phone, android, result]) => `<tr><th scope="row">${phone}</th><td>${android}</td><td>${result}</td></tr>`).join("")}</tbody></table></div>
${tb.body.map((b) => `<p>${b}</p>`).join("")}</section>
</main>
${footer(t)}
</body>
</html>
`;
}

rmSync(dist, { recursive: true, force: true });
mkdirSync(join(dist, "da"), { recursive: true });
writeFileSync(join(dist, "index.html"), page(en));
writeFileSync(join(dist, "da", "index.html"), page(da));
for (const t of pages) {
  mkdirSync(join(dist, t.why.path), { recursive: true });
  writeFileSync(join(dist, t.why.path, "index.html"), whyPage(t));
  mkdirSync(join(dist, t.privacy.path), { recursive: true });
  writeFileSync(join(dist, t.privacy.path, "index.html"), privacyPage(t));
  mkdirSync(join(dist, t.setup.path), { recursive: true });
  writeFileSync(join(dist, t.setup.path, "index.html"), setupPage(t));
}
writeFileSync(join(dist, "404.html"), notFound());
cpSync(join(src, "fonts"), join(dist, "fonts"), { recursive: true });
// Mail logos, linked from the parent app's mails (server/src/lib/mail-templates.ts).
cpSync(join(src, "mail"), join(dist, "mail"), { recursive: true });
for (const f of ["favicon.svg", "favicon-32.png", "apple-touch-icon.png", "og-en.png", "og-da.png"]) {
  cpSync(join(src, f), join(dist, f));
}
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[(p) => p.path, (p) => p.setup.path, (p) => p.privacy.path, (p) => p.why.path]
  .flatMap((route) =>
    pages.map(
      (p) =>
        `<url><loc>${ORIGIN}${route(p)}</loc>${pages
          .map((a) => `<xhtml:link rel="alternate" hreflang="${a.lang}" href="${ORIGIN}${route(a)}"/>`)
          .join("")}</url>`,
    ),
  )
  .join("\n")}
</urlset>
`,
);
// Cloudflare Pages headers. The CSP allows only our own files plus the one inline stylesheet.
writeFileSync(
  join(dist, "_headers"),
  `/*
  Content-Security-Policy: default-src 'none'; style-src 'sha256-${cssHash}'; img-src 'self'; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/fonts/*
  Cache-Control: public, max-age=604800
`,
);
console.log(`Built ${pages.length * 4} pages + 404 into dist/ (css ${css.length} bytes)`);
