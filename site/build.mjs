// SPDX-License-Identifier: Apache-2.0
// Builds the static plainphone.org site into dist/. No dependencies.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import en from "./content/en.mjs";
import da from "./content/da.mjs";
import { help } from "./content/help.mjs";
import sv from "./content/sv.mjs";
import nb from "./content/nb.mjs";
import de from "./content/de.mjs";
import { compatibilityContent } from "./compatibility.mjs";
import { figures } from "./figures.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");
const ORIGIN = "https://plainphone.org";
const GITHUB = "https://github.com/plainphone/plainphone";
const pages = [en, da, sv, nb, de];
const languageNames = { en: "English", da: "Dansk", sv: "Svenska", nb: "Norsk bokmål", de: "Deutsch" };
const ogLocales = { en: "en_GB", da: "da_DK", sv: "sv_SE", nb: "nb_NO", de: "de_DE" };

const css = readFileSync(join(src, "style.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s*\n\s*/g, "")
  .replace(/\s*([{}:;,>])\s*/g, "$1")
  .replace(/;}/g, "}");
const cssHash = createHash("sha256").update(css).digest("base64");
const appSearchFile = "app-search.mjs";
const appSearchHash = createHash("sha256").update(readFileSync(join(src, appSearchFile))).digest("base64");
const wordmark = readFileSync(join(src, "wordmark.svg"), "utf8")
  .trim()
  .replace("<svg ", '<svg class="wordmark" ')
  .replace(/\srole="img"/, "")
  .replace(/\saria-labelledby="[^"]*"><title[^>]*>[^<]*<\/title>/, ' aria-hidden="true" focusable="false">');
if (!wordmark.includes('aria-hidden="true"') || wordmark.includes("<title")) throw new Error("wordmark.svg: unexpected markup");

const ADVISORIES = `${GITHUB}/security/advisories/new`;
const SECURITY_POLICY = `${GITHUB}/blob/main/SECURITY.md`;
const setupImages = ["light", "dark"].flatMap((theme) =>
  ["webp", "png"].map((format) => `setup-choice-${theme}.${format}`),
);

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
    schema = [],
  },
) {
  const alt = alternates
    .map((a) => `<link rel="alternate" hreflang="${a.lang}" href="${ORIGIN}${a.path}">`)
    .join("");
  const ogAlternates = alternates
    .filter((a) => a.lang !== t.lang)
    .map((a) => `<meta property="og:locale:alternate" content="${ogLocales[a.lang]}">`)
    .join("\n");
  const structuredData = [...schema];
  if (!noindex && path !== t.path) {
    structuredData.push({
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Plainphone", item: ORIGIN + t.path },
        { "@type": "ListItem", position: 2, name: plainText(ogTitle), item: ORIGIN + path },
      ],
    });
  }
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@graph": structuredData })
    .replace(/</g, "\\u003c");
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
<meta property="og:locale" content="${ogLocales[t.lang]}">
${ogAlternates}
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(ogTitle)}">
<meta name="twitter:description" content="${esc(description)}">
<meta name="twitter:image" content="${ORIGIN}/og-${t.lang}.png">
<meta name="twitter:image:alt" content="${esc(t.ogAlt)}">
${structuredData.length ? `<script type="application/ld+json">${jsonLd}</script>` : ""}
<style>${css}</style>
</head>`;
}

function languageLinks(route, t) {
  return pages.map((p) =>
    `<li><a href="${route(p)}" hreflang="${p.lang}" lang="${p.lang}"${p === t ? ' aria-current="true"' : ""}>${languageNames[p.lang]}</a></li>`,
  ).join("");
}

function header(t) {
  const l = t.landing;
  return `<a class="skip" href="#main">${t.skip}</a>
<header class="top">
<a class="brand" href="${t.path}">${wordmark}<span class="sr">Plainphone</span></a>
<details class="mobile-menu">
<summary>${l.menu}</summary>
<nav aria-label="${t.nav.label}">
<a href="${t.path}#how">${l.product}</a>
<a href="${t.setup.path}">${l.setup}</a>
<a href="${t.path}#faq">${l.faq}</a>
<a href="#languages">${l.languages}</a>
</nav>
</details>
<nav class="desktop-menu" aria-label="${t.nav.label}">
<a href="${t.path}#how">${l.product}</a>
<a href="${t.setup.path}">${l.setup}</a>
<a href="${t.path}#faq">${l.faq}</a>
<a href="#languages">${l.languages}</a>
</nav>
</header>`;
}

function footer(t, route = (p) => p.path) {
  const l = t.landing;
  return `<footer class="foot">
<div class="foot-links">
<section><h2>${l.help}</h2><ul>
<li><a href="${t.setup.path}">${l.guide}</a></li>
<li><a href="${t.compatibility.path}">${t.compatibility.title}</a></li>
<li><a href="${help[t.lang].path}">${help[t.lang].title}</a></li>
<li><a href="${t.path}#faq">${l.faq}</a></li>
<li><a href="${t.why.path}">${t.why.h1}</a></li>
<li><a href="${t.privacy.path}">${t.privacy.h1}</a></li>
</ul></section>
<section><h2>${l.project}</h2><ul>
<li><a href="${GITHUB}">${l.code}</a></li>
<li><a href="${t.path}#self-hosting">${t.hosting.title}</a></li>
<li><a href="${SECURITY_POLICY}">${l.security}</a></li>
<li><a href="/.well-known/security.txt">security.txt</a></li>
</ul></section>
<section aria-labelledby="languages"><h2 id="languages" tabindex="-1">${l.languages}</h2>
<ul class="language-links" role="list">${languageLinks(route, t)}</ul></section>
</div>
<div class="operator"><p><a href="https://mahoje.dk">Mahoje</a> (CVR 39413892)</p>
<p>${l.visual[2]}</p>
<p>${t.footer.license}</p></div>
</footer>`;
}

const plainText = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");

function landingSchema(t, items) {
  return [
    { "@type": "Organization", name: "Mahoje", url: "https://mahoje.dk", taxID: "DK39413892" },
    {
      "@type": "SoftwareApplication",
      name: "Plainphone",
      description: t.description,
      url: ORIGIN + t.path,
      operatingSystem: "Android 10+",
      applicationCategory: "UtilitiesApplication",
      inLanguage: t.lang,
    },
    {
      "@type": "WebApplication",
      name: "Plainphone Parent Dashboard",
      url: "https://app.plainphone.org/",
      browserRequirements: "Requires a web browser",
      applicationCategory: "UtilitiesApplication",
    },
    {
      "@type": "FAQPage",
      inLanguage: t.lang,
      mainEntity: items.map(({ q, a }) => ({
        "@type": "Question",
        name: plainText(q),
        acceptedAnswer: { "@type": "Answer", text: plainText(a) },
      })),
    },
  ];
}

function page(t) {
  const h = t.hero;
  const l = t.landing;
  const [dayTitle, ...daySteps] = l.day;
  const [childTitle, childBody] = l.child;
  const [imageAlt, imageCaption] = l.visual;
  const faqItems = [
    ...t.faq.items,
    ...l.questions.map(([group, q, a]) => ({ group, q, a })),
    ...t.price.items.map((item) => ({ ...item, group: "price" })),
  ];
  const faqGroups = Object.entries(l.groups).map(([group, title]) => ({
    title,
    items: faqItems.filter((item) => item.group === group),
  }));
  if (faqGroups.flatMap(({ items }) => items).length !== faqItems.length) {
    throw new Error(`${t.lang}: FAQ question is missing a valid group`);
  }
  const section = (id, title, body, cls = "") =>
    `<section class="block ${cls}" aria-labelledby="${id}"><h2 id="${id}">${title}</h2>${body}</section>`;

  const questions = (items) => items
    .map((it) => `<details id="${slug(it.q)}"><summary>${it.q}</summary><p>${it.a}</p></details>`)
    .join("");

  const hero = `<section class="hero home-hero" aria-labelledby="hero-title">
<div class="hero-copy">
<p class="status"><span>${t.status}</span></p>
<h1 id="hero-title">${h.title}</h1>
<p class="lead">${h.lead}</p>
<div class="hero-actions">
<a class="button" href="https://app.plainphone.org/">${l.start}</a>
<a href="${t.setup.path}">${l.guide}</a>
</div>
</div>
<figure class="product-shot">
<picture>
<source media="(prefers-color-scheme: dark)" type="image/webp" srcset="/setup-choice-dark.webp">
<source media="(prefers-color-scheme: dark)" srcset="/setup-choice-dark.png">
<source type="image/webp" srcset="/setup-choice-light.webp">
<img src="/setup-choice-light.png" width="375" height="465" alt="${esc(imageAlt)}" fetchpriority="high">
</picture>
<figcaption>${imageCaption}</figcaption>
</figure>
<div class="ledger">
<div><h2>${h.staysLabel}</h2><ul class="stays" role="list">${h.stays.map((s) => `<li>${s}</li>`).join("")}</ul></div>
<div><h2>${h.goesLabel}</h2><ul class="goes" role="list">${h.goes.map((s) => `<li>${s}</li>`).join("")}</ul></div>
</div>
</section>`;

  const who = section(
    "who",
    t.who.title,
    `<div class="paths">${t.who.paths
      .map((p) => `<article class="path" id="${p.id}"><h3>${p.title}</h3><p>${p.body}</p></article>`)
      .join("")}</div>`,
  );

  const how = section(
    "how",
    t.how.title,
    `<p>${t.how.lead}</p><div class="mode-diagram"><p class="mode-root">${l.diagram}</p><ul class="modes" role="list">${t.how.steps
      .map((s) => `<li><h3>${s.title}</h3><p>${s.body}</p></li>`)
      .join("")}</ul></div><p><a class="button" href="${t.setup.path}">${t.how.guide}</a></p>
<p>${t.how.available}</p><p class="note">${t.how.note}</p>
<p><a href="${t.why.path}">${t.why.h1}</a></p>`,
  );

  const firstDay = section("first-day", dayTitle,
    `<ol class="first-day">${daySteps.map((step) => `<li>${step}</li>`).join("")}</ol>`);
  const childView = section("child-view", childTitle, `<p>${childBody}</p>`);
  const phones = section("phones", t.phones.title, `<p>${t.phones.body}</p>`);

  const o = t.open;
  const open = section(
    "open",
    o.title,
    `<p>${o.body}</p>
<ul>
<li><a href="${GITHUB}">${o.github}</a></li>
<li><a href="${GITHUB}/issues">${o.issues}</a></li>
<li><a href="${GITHUB}/blob/main/SECURITY.md">${o.privateReport}</a></li>
<li><a href="${GITHUB}/blob/main/CONTRIBUTING.md">${o.contribute}</a></li>
</ul>`,
  );

  const host = t.hosting;
  const hosting = section("self-hosting", host.title,
    `<p>${host.body}</p><p><a href="${GITHUB}/blob/main/docs/self-hosting.md">${host.guide}</a></p>`);

  const price = section("price", t.price.title, `<p>${t.price.body}</p>`);

  const privacy = t.privacySummary;
  const privacySummary = section("privacy", privacy.title,
    `<p>${privacy.body}</p><p><a href="${t.privacy.path}">${privacy.link}</a></p>`);

  const faq = section("faq", t.faq.title, faqGroups.map(({ title, items }) =>
    `<div class="faq-group"><h3>${esc(title)}</h3><div>${questions(items)}</div></div>`,
  ).join("") + `<p><a href="${help[t.lang].path}">${help[t.lang].title}</a></p>`);

  return `${head(t, { path: t.path, schema: landingSchema(t, faqGroups.flatMap(({ items }) => items)) })}
<body>
${header(t)}
<main id="main" tabindex="-1">
${hero}
${who}
${how}
${phones}
${firstDay}
${childView}
${privacySummary}
${open}
${hosting}
${price}
${faq}
</main>
${footer(t)}
</body>
</html>
`;
}

function compatibilityPage(t) {
  const p = t.compatibility;
  return `${head(t, {
    path: p.path,
    title: p.title,
    description: p.lead,
    ogTitle: p.title,
    alternates: pages.map((page) => ({ lang: page.lang, path: page.compatibility.path })),
    xDefault: en.compatibility.path,
  })}
<body>
${header(t)}
<main id="main" tabindex="-1" class="doc compatibility">
${compatibilityContent(t, esc)}
</main>
${footer(t, (page) => page.compatibility.path)}
<script type="module" src="/${appSearchFile}" integrity="sha256-${appSearchHash}"></script>
</body>
</html>
`;
}

function notFound() {
  const t = en;
  return `${head({ ...t, title: `${t.notFound.title}: Plainphone` }, { path: "/404", noindex: true, description: `${t.notFound.body} ${t.notFound.back}.` })}
<body>
${header(t)}
<main id="main" tabindex="-1" class="hero">
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
  return `${head(t, {
    path: p.path,
    title: p.h1,
    description: p.lead,
    ogTitle: p.h1,
    alternates: pages.map((x) => ({ lang: x.lang, path: x.why.path })),
    xDefault: pages[0].why.path,
  })}
<body>
${header(t)}
<main id="main" tabindex="-1" class="doc">
<h1>${p.h1}</h1>
<p class="lead">${p.lead}</p>
${p.sections.map(([title, body]) => `<section><h2>${title}</h2><p>${body}</p></section>`).join("\n")}
<section>
<h2>${p.sourcesTitle}</h2>
<ul>${p.sources.map(([label, url]) => `<li><a href="${esc(url)}">${label}</a></li>`).join("")}</ul>
</section>
</main>
${footer(t, (p) => p.why.path)}
</body>
</html>
`;
}

function helpPage(t) {
  const p = help[t.lang];
  const alternatives = pages.map(({ lang }) => ({ lang, path: help[lang].path }));
  const section = ({ id, title, body }) => `<section id="${id}" aria-labelledby="${id}-title">
<h2 id="${id}-title">${esc(title)}</h2>
${body.map((block) => typeof block === "string"
    ? `<p>${block}</p>`
    : `<ol>${block.steps.map((step) => `<li>${step}</li>`).join("")}</ol>`).join("\n")}
</section>`;
  return `${head(t, {
    path: p.path, title: `${p.title} | Plainphone`, description: p.lead, ogTitle: p.title,
    alternates: alternatives, xDefault: help.en.path,
  })}
<body>
${header(t)}
<main id="main" tabindex="-1" class="doc">
<h1>${esc(p.title)}</h1>
<p class="lead">${esc(p.lead)}</p>
<nav class="toc" aria-label="${esc(p.topics)}">
<ul>${[...p.sections, { id: "contact", title: p.contact }].map(({ id, title }) =>
    `<li><a href="#${id}">${esc(title)}</a></li>`).join("")}</ul>
</nav>
${p.sections.map(section).join("\n")}
<section id="contact" aria-labelledby="contact-title">
<h2 id="contact-title">${esc(p.contact)}</h2>
<p>${esc(p.contactText)}</p>
<p><a href="mailto:support@plainphone.org">support@plainphone.org</a></p>
</section>
</main>
${footer(t, (x) => help[x.lang].path)}
</body>
</html>`;
}

// The privacy policy: long-form text in content/*.mjs under `privacy`.
// A block is a string (paragraph), { list: [...] } or { table: { caption, cols, rows } }.
function privacyPage(t) {
  const p = t.privacy;
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
${header(t)}
<main id="main" tabindex="-1" class="doc">
<h1>${p.h1}</h1>
<p class="updated">${p.updated}</p>
<p class="lead">${p.lead}</p>
<p class="note">${p.status}</p>
<nav class="toc" aria-label="${p.tocLabel}"><ul>${p.sections.map((s) => `<li><a href="#${s.id}">${s.title}</a></li>`).join("")}</ul></nav>
<section class="short" aria-labelledby="short"><h2 id="short">${p.short.title}</h2>${block({ list: p.short.list })}</section>
${p.sections.map(section).join("\n")}
</main>
${footer(t, (p) => p.privacy.path)}
</body>
</html>
`;
}

function setupPage(t) {
  const p = t.setup;
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
${header(t)}
<main id="main" tabindex="-1" class="doc setup">
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
<p>${p.strongLanguage}</p>
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
${footer(t, (p) => p.setup.path)}
</body>
</html>
`;
}

rmSync(dist, { recursive: true, force: true });
for (const t of pages) {
  mkdirSync(join(dist, help[t.lang].path), { recursive: true });
  writeFileSync(join(dist, help[t.lang].path, "index.html"), helpPage(t));
  mkdirSync(join(dist, t.path), { recursive: true });
  writeFileSync(join(dist, t.path, "index.html"), page(t));
  mkdirSync(join(dist, t.compatibility.path), { recursive: true });
  writeFileSync(join(dist, t.compatibility.path, "index.html"), compatibilityPage(t));
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
for (const f of [appSearchFile, "favicon.svg", "favicon-32.png", "apple-touch-icon.png", ...pages.map((t) => `og-${t.lang}.png`), ...setupImages]) {
  cpSync(join(src, f), join(dist, f));
}
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[(p) => p.path, (p) => p.setup.path, (p) => p.privacy.path, (p) => p.why.path, (p) => p.compatibility.path, (p) => help[p.lang].path]
  .flatMap((route) =>
    pages.map(
      (p) =>
        `<url><loc>${ORIGIN}${route(p)}</loc>${pages
          .map((a) => `<xhtml:link rel="alternate" hreflang="${a.lang}" href="${ORIGIN}${route(a)}"/>`)
          .join("")}<xhtml:link rel="alternate" hreflang="x-default" href="${ORIGIN}${route(en)}"/></url>`,
    ),
  )
  .join("\n")}
</urlset>
`,
);
mkdirSync(join(dist, ".well-known"), { recursive: true });
writeFileSync(join(dist, ".well-known", "security.txt"),
  `Contact: ${ADVISORIES}
Contact: mailto:support@plainphone.org
Expires: 2027-11-18T00:00:00Z
Preferred-Languages: en, da
Canonical: ${ORIGIN}/.well-known/security.txt
Policy: ${SECURITY_POLICY}
`,
);
// Cloudflare Pages headers. The CSP pins the shared inline stylesheet and compatibility search module.
writeFileSync(
  join(dist, "_headers"),
  `/*
  Content-Security-Policy: default-src 'none'; style-src 'sha256-${cssHash}'; img-src 'self'; font-src 'self'; connect-src 'self'; script-src 'sha256-${appSearchHash}'; style-src-attr 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
  X-Content-Type-Options: nosniff
  Referrer-Policy: no-referrer
  Permissions-Policy: camera=(), microphone=(), geolocation=(), browsing-topics=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
  Strict-Transport-Security: max-age=31536000; includeSubDomains

/.well-known/security.txt
  Content-Type: text/plain; charset=utf-8

/fonts/*
  Cache-Control: public, max-age=604800

/mail/*
  ! Cross-Origin-Resource-Policy
  Cross-Origin-Resource-Policy: cross-origin
`,
);
console.log(`Built ${pages.length * 6} pages + 404 into dist/ (css ${css.length} bytes)`);
