// SPDX-License-Identifier: Apache-2.0
// Builds the static plainphone.org site into dist/. No dependencies.
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import en from "./content/en.mjs";
import da from "./content/da.mjs";
import { help } from "./content/help.mjs";
import { home } from "./content/home.mjs";
import { giving, organisations } from "./content/giving.mjs";
import sv from "./content/sv.mjs";
import nb from "./content/nb.mjs";
import de from "./content/de.mjs";
import { compatibilityContent } from "./compatibility.mjs";
import { figures } from "./figures.mjs";
import { press } from "./content/press.mjs";
import { KIT, ZIP, pressContent, pressFiles } from "./press.mjs";

const root = dirname(fileURLToPath(import.meta.url));
const src = join(root, "src");
const dist = join(root, "dist");
const ORIGIN = "https://plainphone.org";
const GITHUB = "https://github.com/plainphone/plainphone";
const STATUS_URL = "https://status.plainphone.org";
const pages = [en, da, sv, nb, de];
const languageNames = { en: "English", da: "Dansk", sv: "Svenska", nb: "Norsk bokmål", de: "Deutsch" };
const ogLocales = { en: "en_GB", da: "da_DK", sv: "sv_SE", nb: "nb_NO", de: "de_DE" };
// Direction C paper, light and dark (docs/brand/README.md).
const THEME = { light: "#f5f5f3", dark: "#0f0f0f" };

const css = readFileSync(join(src, "style.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\s*\n\s*/g, "")
  .replace(/\s*([{}:;,>])\s*/g, "$1")
  .replace(/;}/g, "}");
const cssHash = createHash("sha256").update(css).digest("base64");
const appSearchFile = "app-search.mjs";
const appSearchHash = createHash("sha256").update(readFileSync(join(src, appSearchFile))).digest("base64");

// The brand files in src/brand/ are copies of docs/brand/directions/c/. The wordmark is
// outlined and drawn in currentColor. The mark is drawn inline with classes, so the
// stylesheet can switch it to the dark-mode drawing (no outline, the green carries the shape).
const wordmark = readFileSync(join(src, "brand", "wordmark.svg"), "utf8")
  .trim()
  .replace("<svg ", '<svg class="wordmark" ')
  .replace(/\srole="img" aria-label="[^"]*">/, ' aria-hidden="true" focusable="false">');
if (!wordmark.includes('aria-hidden="true"') || wordmark.includes("aria-label")) throw new Error("wordmark.svg: unexpected markup");
const mark = '<svg class="mark" viewBox="0 0 64 64" aria-hidden="true" focusable="false"><rect class="m-body" x="19" y="5" width="26" height="54" rx="13"/><circle class="m-knob" cx="32" cy="45" r="7.5"/></svg>';
const lockup = `${mark}${wordmark}<span class="sr">Plainphone</span>`;

const ADVISORIES = `${GITHUB}/security/advisories/new`;
const SECURITY_POLICY = `${GITHUB}/blob/main/SECURITY.md`;
const icons = ["favicon.svg", "favicon-32.png", "apple-touch-icon.png"];

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
<meta name="theme-color" content="${THEME.light}" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="${THEME.dark}" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="preload" href="/fonts/schibsted-grotesk.woff2" as="font" type="font/woff2" crossorigin>
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

// `current` marks the nav link for the page you are on; `route` maps a language to the
// same page in that language, for the language menus.
function header(t, current, route = (p) => p.path) {
  const h = home[t.lang];
  const links = [
    [`${t.path}#how`, h.nav.how, "how"],
    [t.setup.path, t.landing.setup, "setup"],
    [t.compatibility.path, h.nav.apps, "apps"],
    [`${t.path}#faq`, t.landing.faq, "faq"],
  ]
    .map(([href, label, key]) => `<a href="${href}"${key === current ? ' aria-current="page"' : ""}>${label}</a>`)
    .join("");
  return `<a class="skip" href="#main">${t.skip}</a>
<header class="top"><div class="wrap">
<a class="brand" href="${t.path}">${lockup}</a>
<nav class="nav" aria-label="${t.nav.label}">${links}</nav>
<div class="top-actions">
<details class="pop lang"><summary>${t.lang.toUpperCase()}<span class="sr"> (${h.nav.language}: ${languageNames[t.lang]})</span></summary>
<div class="pop-panel"><ul role="list">${languageLinks(route, t)}</ul></div></details>
<details class="pop menu"><summary>${t.landing.menu}</summary>
<div class="pop-panel"><nav aria-label="${t.nav.label}">${links}</nav>
<p class="menu-label">${h.nav.language}</p><ul class="languages" role="list">${languageLinks(route, t)}</ul></div></details>
</div>
</div></header>`;
}

function footer(t, route = (p) => p.path) {
  const l = t.landing;
  return `<footer class="foot"><div class="wrap">
<div class="foot-grid">
<div><span class="brand">${lockup}</span><p>${l.privacyNote}</p></div>
<section aria-labelledby="foot-help"><h2 id="foot-help">${l.help}</h2><ul>
<li><a href="${t.setup.path}">${l.guide}</a></li>
<li><a href="${t.compatibility.path}">${t.compatibility.title}</a></li>
<li><a href="${help[t.lang].path}">${help[t.lang].title}</a></li>
<li><a href="${t.path}#faq">${l.faq}</a></li>
<li><a href="${t.why.path}">${t.why.h1}</a></li>
<li><a href="${t.privacy.path}">${t.privacy.h1}</a></li>
<li><a href="${STATUS_URL}" target="_blank" rel="noopener noreferrer">${l.status}</a></li>
</ul></section>
<section aria-labelledby="foot-project"><h2 id="foot-project">${l.project}</h2><ul>
<li><a href="${GITHUB}">${l.code}</a></li>
<li><a href="${t.path}#self-hosting">${t.hosting.title}</a></li>
<li><a href="${SECURITY_POLICY}">${l.security}</a></li>
<li><a href="/.well-known/security.txt">security.txt</a></li>
<li><a href="${press[t.lang].path}">${press[t.lang].h1}</a></li>
</ul></section>
<section aria-labelledby="languages"><h2 id="languages" tabindex="-1">${l.languages}</h2>
<ul class="language-links" role="list">${languageLinks(route, t)}</ul></section>
</div>
<div class="operator"><p><a href="https://mahoje.dk">Mahoje</a> (CVR 39413892)</p>
<p>${t.footer.license}</p></div>
</div></footer>
<script type="module" src="/${appSearchFile}" integrity="sha256-${appSearchHash}"></script>`;
}

function statusParagraph(text) {
  if (!text.includes("{STATUS_LINK}")) throw new Error("A translation of statusText lacks {STATUS_LINK}");
  return text.replace("{STATUS_LINK}", `href="${STATUS_URL}" target="_blank" rel="noopener noreferrer"`);
}

const plainText = (html) => html.replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");

// No ratings or reviews: there are none to cite. The price is what it is today, free.
const ORGANIZATION = {
  "@type": "Organization",
  "@id": "https://mahoje.dk/#organization",
  name: "Mahoje",
  url: "https://mahoje.dk",
  taxID: "DK39413892",
  address: { "@type": "PostalAddress", addressCountry: "DK" },
};
const LICENSE_URL = "https://www.apache.org/licenses/LICENSE-2.0";
const FREE = { "@type": "Offer", price: "0", priceCurrency: "EUR" };

function landingSchema(t, items) {
  return [
    ORGANIZATION,
    {
      "@type": "SoftwareApplication",
      name: "Plainphone",
      description: t.description,
      url: ORIGIN + t.path,
      image: `${ORIGIN}/og-${t.lang}.png`,
      operatingSystem: "Android 10+",
      applicationCategory: "UtilitiesApplication",
      inLanguage: pages.map((p) => p.lang),
      license: LICENSE_URL,
      isAccessibleForFree: true,
      offers: FREE,
      downloadUrl: `${GITHUB}/releases`,
      sameAs: [GITHUB],
      publisher: { "@id": ORGANIZATION["@id"] },
    },
    {
      "@type": "WebApplication",
      name: "Plainphone Parent Dashboard",
      url: "https://app.plainphone.org/",
      browserRequirements: "Requires a web browser",
      applicationCategory: "UtilitiesApplication",
      isAccessibleForFree: true,
      offers: FREE,
      publisher: { "@id": ORGANIZATION["@id"] },
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

const sw = (on) => `<span class="sw${on ? " on" : ""}" aria-hidden="true"></span>`;

// Real screenshots from `pnpm site:screenshots`: WebP at 1x and 2x, light and dark, in every language.
// The sizes come from img/manifest.json, so width and height always match the files.
const shotSizes = JSON.parse(readFileSync(join(src, "img", "manifest.json"), "utf8"));

function picture(name, lang, alt, { eager = false } = {}) {
  const { width, height } = shotSizes[name][lang];
  const set = (scheme) => `/img/${name}-${lang}-${scheme}-1x.webp 1x, /img/${name}-${lang}-${scheme}-2x.webp 2x`;
  return `<picture><source media="(prefers-color-scheme: dark)" srcset="${set("dark")}"><img src="/img/${name}-${lang}-light-1x.webp" srcset="${set("light")}" width="${width}" height="${height}" alt="${esc(alt)}"${eager ? ' fetchpriority="high"' : ' loading="lazy"'} decoding="async"></picture>`;
}

function shot(name, t, extra = {}) {
  const s = home[t.lang].shots[name];
  return `<figure class="shot ${name}">${picture(name, t.lang, s.alt, extra)}<figcaption>${s.caption}</figcaption></figure>`;
}

function page(t) {
  const h = t.hero;
  const l = t.landing;
  const hm = home[t.lang];
  const [dayTitle, ...daySteps] = l.day;
  const childBody = l.childSees;
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
  const head2 = (id, title, lead = "") =>
    `<div class="section-head"><h2 id="${id}-title">${title}</h2>${lead ? `<p>${lead}</p>` : ""}</div>`;

  const hero = `<section class="hero wrap" aria-labelledby="hero-title">
<div>
<p class="status"><a href="#alpha">${t.status}</a></p>
<h1 id="hero-title">${h.title}</h1>
<p class="lead">${h.lead}</p>
<div class="actions">
<a class="button" href="https://app.plainphone.org/">${l.start}</a>
<a class="button quiet" href="${t.setup.path}">${l.guide}</a>
</div>
<p class="note">${hm.note}</p>
</div>
${shot("dashboard", t, { eager: true })}
</section>`;

  const s = hm.switches;
  const switches = `<section class="section wrap" id="how" aria-labelledby="how-title">
${head2("how", s.title, s.lead)}
<div class="board">
<div class="always"><h3>${s.alwaysTitle}</h3><p>${s.alwaysBody}</p>
<ul role="list">${s.always.map(([name, body]) => `<li><strong>${name}</strong><span class="desc">${body}</span><span class="state">${sw(true)}${s.alwaysOn}</span></li>`).join("")}</ul></div>
<div class="choose"><h3>${s.chooseTitle}</h3><p>${s.chooseBody}</p>
<dl>${s.choose.map(([name, body]) => `<div><dt>${name}</dt><dd>${body}</dd></div>`).join("")}</dl></div>
</div>
</section>`;

  const d = hm.decide;
  const decide = `<section class="section wrap split" id="decide" aria-labelledby="decide-title">
<div><h2 id="decide-title">${d.title}</h2>${d.body.map((b) => `<p>${b}</p>`).join("")}</div>
${shot("requests", t)}
</section>`;

  const c = hm.sees;
  const childView = `<section class="section wrap" id="child-view" aria-labelledby="child-view-title">
<div class="child-text"><h2 id="child-view-title">${c.title}</h2><p>${childBody}</p><p>${c.extra}</p></div>
<div class="shots">${["home", "blocked", "sharing"].map((name) => shot(name, t)).join("")}</div>
<p class="note shots-note">${hm.shots.note}</p>
</section>`;

  const who = `<section class="section wrap" id="who" aria-labelledby="who-title">
${head2("who", t.who.title)}
<div class="paths">${t.who.paths
    .map((path) => `<article class="path" id="${path.id}"><h3>${path.title}</h3><p>${path.body}</p></article>`)
    .join("")}</div>
</section>`;

  const m = hm.modes;
  const modes = `<section class="section wrap" id="modes" aria-labelledby="modes-title">
${head2("modes", m.title, t.how.lead)}
<div class="table-wrap compare" role="region" aria-label="${esc(m.caption)}" tabindex="0"><table>
<caption class="sr">${m.caption}</caption>
<thead><tr><th scope="col"><span class="sr">${m.corner}</span></th>${t.how.steps.map((step) => `<th scope="col">${step.title}</th>`).join("")}</tr></thead>
<tbody>${m.rows.map(([label, strong, light]) => `<tr><th scope="row">${label}</th><td>${strong}</td><td>${light}</td></tr>`).join("")}</tbody>
</table></div>
<div class="actions"><a class="button" href="${t.setup.path}">${t.how.guide}</a></div>
<div class="after-table"><p>${t.how.available}</p><p class="note">${t.how.note}</p>
<p><a href="${t.why.path}">${t.why.h1}</a></p></div>
</section>`;

  const firstDay = `<section class="section wrap" id="first-day" aria-labelledby="first-day-title">
${head2("first-day", dayTitle)}
<ol class="steps">${daySteps.map((step) => `<li>${step}</li>`).join("")}</ol>
</section>`;

  // Alpha status, right after the hero: what alpha means, the one tested phone, and what to do now.
  const a = hm.alpha;
  const alpha = `<section class="section wrap" id="alpha" aria-labelledby="alpha-title">
<div class="notice alpha">
<div><h2 id="alpha-title">${a.title}</h2>${a.body.map((b) => `<p>${b}</p>`).join("")}
<h3>${t.phones.title}</h3><p>${t.phones.body}</p></div>
<div><h3>${a.nextTitle}</h3><ul role="list">
<li><a href="${t.setup.path}">${a.next.guide}</a></li>
<li><a href="${GITHUB}">${a.next.star}</a></li>
<li><a href="${GITHUB}/releases">${a.next.releases}</a></li>
<li><a href="${GITHUB}/issues/new/choose">${a.next.feedback}</a></li>
</ul><p>${a.next.mail} <a href="mailto:support@plainphone.org">support@plainphone.org</a></p></div>
</div></section>`;

  const o = t.open;
  const host = t.hosting;
  // The first sentence of the price text is the promise; it is set large.
  const [priceLead, ...priceRest] = t.price.body.split(/(?<=\.) /);
  const free = `<section class="section wrap" id="free" aria-labelledby="free-title">
${head2("free", hm.free)}
<div class="open-grid">
<div id="price"><h3>${t.price.title}</h3><p class="price-line">${priceLead}</p><p>${priceRest.join(" ")}</p></div>
<div id="open"><h3>${o.title}</h3><p>${o.body}</p>
<ul>
<li><a href="${GITHUB}">${o.github}</a></li>
<li><a href="${GITHUB}/issues">${o.issues}</a></li>
<li><a href="${GITHUB}/blob/main/SECURITY.md">${o.privateReport}</a></li>
<li><a href="${GITHUB}/blob/main/CONTRIBUTING.md">${o.contribute}</a></li>
</ul></div>
<div id="self-hosting"><h3>${host.title}</h3><p>${host.body}</p><p><a href="${GITHUB}/blob/main/docs/self-hosting.md">${host.guide}</a></p></div>
</div>
</section>`;

  const ps = t.privacySummary;
  const privacy = `<section class="section wrap privacy-short" id="privacy" aria-labelledby="privacy-title">
<h2 id="privacy-title">${ps.title}</h2>
<div><p>${ps.body}</p><p><a href="${t.privacy.path}">${ps.link}</a></p></div>
</section>`;

  const questions = (items) => items
    .map((it) => `<details class="qa" id="${slug(it.q)}"><summary>${it.q}</summary><p>${it.a}</p></details>`)
    .join("");
  const faq = `<section class="section wrap" id="faq" aria-labelledby="faq-title">
${head2("faq", t.faq.title)}
${faqGroups.map(({ title, items }) => `<div class="faq-group"><h3>${esc(title)}</h3><div>${questions(items)}</div></div>`).join("")}
<p class="faq-more"><a href="${help[t.lang].path}">${help[t.lang].title}</a></p>
</section>`;

  const closing = `<section class="wrap" aria-labelledby="closing-title"><div class="closing">
<h2 id="closing-title">${hm.closing.title}</h2>
<p>${hm.closing.body}</p>
<div class="actions"><a class="button" href="https://app.plainphone.org/">${l.start}</a><a class="button quiet" href="${t.setup.path}">${l.guide}</a></div>
</div></section>`;

  return `${head(t, { path: t.path, schema: landingSchema(t, faqGroups.flatMap(({ items }) => items)) })}
<body>
${header(t)}
<main id="main" tabindex="-1">
${hero}
${alpha}
${switches}
${decide}
${childView}
${who}
${modes}
${firstDay}
${free}
${privacy}
${faq}
${closing}
</main>
${footer(t)}
</body>
</html>
`;
}

function compatibilityPage(t) {
  const p = t.compatibility;
  const route = (page) => page.compatibility.path;
  return `${head(t, {
    path: p.path,
    title: p.title,
    description: p.lead,
    ogTitle: p.title,
    alternates: pages.map((page) => ({ lang: page.lang, path: page.compatibility.path })),
    xDefault: en.compatibility.path,
  })}
<body>
${header(t, "apps", route)}
<main id="main" tabindex="-1" class="doc compatibility">
${compatibilityContent(t, esc)}
</main>
${footer(t, route)}
</body>
</html>
`;
}

function notFound() {
  const t = en;
  return `${head({ ...t, title: `${t.notFound.title}: Plainphone` }, { path: "/404", noindex: true, description: `${t.notFound.body} ${t.notFound.back}.` })}
<body>
${header(t)}
<main id="main" tabindex="-1" class="wrap lost">
<h1>${t.notFound.title}</h1>
<p class="lead">${t.notFound.body}</p>
<ul>
<li><a href="/">${t.notFound.back}</a></li>
<li lang="da"><a href="/da/">${da.notFound.back}</a></li>
</ul>
</main>
${footer(t)}
</body>
</html>
`;
}

function whyPage(t) {
  const p = t.why;
  const route = (x) => x.why.path;
  return `${head(t, {
    path: p.path,
    title: p.h1,
    description: p.lead,
    ogTitle: p.h1,
    alternates: pages.map((x) => ({ lang: x.lang, path: x.why.path })),
    xDefault: pages[0].why.path,
  })}
<body>
${header(t, "why", route)}
<main id="main" tabindex="-1" class="doc">
<h1>${p.h1}</h1>
<p class="lead">${p.lead}</p>
${p.sections.map(([title, body]) => `<section><h2>${title}</h2><p>${body}</p></section>`).join("\n")}
<section>
<h2>${p.sourcesTitle}</h2>
<ul>${p.sources.map(([label, url]) => `<li><a href="${esc(url)}">${label}</a></li>`).join("")}</ul>
</section>
</main>
${footer(t, route)}
</body>
</html>
`;
}

function helpPage(t) {
  const p = help[t.lang];
  const route = (x) => help[x.lang].path;
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
${header(t, "help", route)}
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
<p>${statusParagraph(p.statusText)}</p>
</section>
</main>
${footer(t, route)}
</body>
</html>`;
}

// The privacy policy: long-form text in content/*.mjs under `privacy`.
// A block is a string (paragraph), { list: [...] } or { table: { caption, cols, rows } }.
function privacyPage(t) {
  const p = t.privacy;
  const route = (x) => x.privacy.path;
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
${header(t, "privacy", route)}
<main id="main" tabindex="-1" class="doc">
<h1>${p.h1}</h1>
<p class="updated">${p.updated}</p>
<p class="lead">${p.lead}</p>
<p class="notice-box">${p.status}</p>
<nav class="toc" aria-label="${p.tocLabel}"><ul>${p.sections.map((s) => `<li><a href="#${s.id}">${s.title}</a></li>`).join("")}</ul></nav>
<section class="short" aria-labelledby="short"><h2 id="short">${p.short.title}</h2>${block({ list: p.short.list })}</section>
${p.sections.map(section).join("\n")}
</main>
${footer(t, route)}
</body>
</html>
`;
}

// "Give directly" (issue #103). Unlinked and noindex until Mads confirms the organisations' permission:
// no nav, footer or sitemap entry points here, and head() writes robots noindex (no canonical, no hreflang).
// See content/giving.mjs for how to publish it.
function givingPage(t) {
  const p = giving[t.lang];
  const route = (x) => giving[x.lang].path;
  return `${head(t, { path: p.path, noindex: true, title: p.title, description: p.description, ogTitle: p.h1 })}
<body>
${header(t, "giving", route)}
<main id="main" tabindex="-1" class="doc">
<h1>${p.h1}</h1>
<p class="lead">${p.lead}</p>
${p.body.map((b) => `<p>${b}</p>`).join("\n")}
<section aria-labelledby="giving-list"><h2 id="giving-list">${p.listTitle}</h2>
<p>${p.listNote}</p>
<ul>${organisations.map(([name, url]) => `<li><a href="${esc(url)}" rel="noopener noreferrer">${esc(name)}</a></li>`).join("")}</ul>
</section>
</main>
${footer(t, route)}
</body>
</html>
`;
}

function setupPage(t) {
  const p = t.setup;
  const route = (x) => x.setup.path;
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
${header(t, "setup", route)}
<main id="main" tabindex="-1" class="doc setup">
<h1>${p.h1}</h1>
<p class="lead">${p.lead}</p>
<section aria-labelledby="phone-choice">
<h2 id="phone-choice">${p.question}</h2>
<div class="setup-paths">
  <div><strong>${p.strong}</strong><span>${p.strongHelp}</span><a class="button" href="https://app.plainphone.org/add?mode=strong">${p.startStrong}</a><a href="#strong">${p.stepsLink}</a></div>
  <div><strong>${p.light}</strong><span>${p.lightHelp}</span><a class="button" href="https://app.plainphone.org/add?mode=light">${p.startLight}</a><a href="#light">${p.stepsLink}</a></div>
</div>
</section>
<section aria-labelledby="strong"><h2 id="strong">${p.strong}</h2>
<p>${p.start}</p>
<p>${p.strongLanguage}</p>
<ol class="guide">
${p.steps
  .map((st) => `<li><h3>${st.title}</h3>${st.body.map((b) => `<p>${b}</p>`).join("")}${figure(st.fig)}</li>`)
  .join("\n")}
</ol></section>
<section aria-labelledby="light"><h2 id="light">${p.light}</h2>
<p>${p.start}</p>
<ol class="guide">
${p.lightSteps.map(([title, body, fig]) => `<li><h3>${title}</h3><p>${body}</p>${figure(fig)}</li>`).join("\n")}
</ol></section>
<section aria-labelledby="after"><h2 id="after">${p.nextTitle}</h2><p>${p.next}</p></section>
<section aria-labelledby="trouble"><h2 id="trouble">${p.troubleTitle}</h2><dl>${[...p.trouble, ...p.lightHelpItems]
    .map(([q, a]) => `<dt>${q}</dt><dd>${a}</dd>`)
    .join("")}</dl><p class="help">${p.help}</p></section>
<section aria-labelledby="tested"><h2 id="tested">${p.testedTitle}</h2><div class="table-wrap" role="region" aria-label="${esc(tb.caption)}" tabindex="0"><table>
<caption class="sr">${tb.caption}</caption>
<thead><tr>${tb.cols.map((c) => `<th scope="col">${c}</th>`).join("")}</tr></thead>
<tbody>${tb.rows.map(([phone, android, result]) => `<tr><th scope="row">${phone}</th><td>${android}</td><td>${result}</td></tr>`).join("")}</tbody></table></div>
${tb.body.map((b) => `<p>${b}</p>`).join("")}</section>
</main>
${footer(t, route)}
</body>
</html>
`;
}

const kitFiles = pressFiles(src);
const zipSize = kitFiles.find((f) => f.name === ZIP).data.length;

function pressPage(t) {
  const p = press[t.lang];
  const route = (x) => press[x.lang].path;
  return `${head(t, {
    path: p.path,
    title: p.title,
    description: p.description,
    ogTitle: p.h1,
    alternates: pages.map((x) => ({ lang: x.lang, path: press[x.lang].path })),
    xDefault: press.en.path,
  })}
<body>
${header(t, "press", route)}
<main id="main" tabindex="-1" class="doc press">
${pressContent(t, { esc, picture, github: GITHUB, zipSize })}
</main>
${footer(t, route)}
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
  mkdirSync(join(dist, giving[t.lang].path), { recursive: true });
  writeFileSync(join(dist, giving[t.lang].path, "index.html"), givingPage(t));
  mkdirSync(join(dist, t.setup.path), { recursive: true });
  writeFileSync(join(dist, t.setup.path, "index.html"), setupPage(t));
  mkdirSync(join(dist, press[t.lang].path), { recursive: true });
  writeFileSync(join(dist, press[t.lang].path, "index.html"), pressPage(t));
}
mkdirSync(join(dist, KIT), { recursive: true });
for (const { name, data } of kitFiles) writeFileSync(join(dist, KIT, name), data);
writeFileSync(join(dist, "404.html"), notFound());
cpSync(join(src, "fonts"), join(dist, "fonts"), { recursive: true });
// Mail logos, linked from the parent app's mails (server/src/lib/mail-templates.ts).
cpSync(join(src, "mail"), join(dist, "mail"), { recursive: true });
cpSync(join(src, "img"), join(dist, "img"), { recursive: true, filter: (f) => !f.endsWith("manifest.json") });
cpSync(join(src, "brand", "favicon.svg"), join(dist, "favicon.svg"));
for (const f of [appSearchFile, ...icons.filter((f) => f !== "favicon.svg"), ...pages.map((t) => `og-${t.lang}.png`)]) {
  cpSync(join(src, f), join(dist, f));
}
writeFileSync(join(dist, "robots.txt"), `User-agent: *\nAllow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`);
writeFileSync(
  join(dist, "sitemap.xml"),
  `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">
${[(p) => p.path, (p) => p.setup.path, (p) => p.privacy.path, (p) => p.why.path, (p) => p.compatibility.path, (p) => help[p.lang].path, (p) => press[p.lang].path]
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

/img/*
  Cache-Control: public, max-age=86400

/press-kit/*
  Cache-Control: public, max-age=86400

/mail/*
  ! Cross-Origin-Resource-Policy
  Cross-Origin-Resource-Policy: cross-origin
`,
);
console.log(`Built ${pages.length * 8} pages + 404 into dist/ (css ${css.length} bytes, press kit zip ${zipSize} bytes)`);
