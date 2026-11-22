// SPDX-License-Identifier: Apache-2.0
// The press kit: the page body for /press/ (and its language equivalents) and the files it links to.
// The files go to /press-kit/ in dist, together with a zip of everything, built without dependencies.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { press } from "./content/press.mjs";
import { home } from "./content/home.mjs";
import { zip } from "./zip.mjs";

export const KIT = "/press-kit";
export const ZIP = "plainphone-press-kit.zip";
const LANGS = ["en", "da", "sv", "nb", "de"];
const SHOTS = ["dashboard", "requests", "home", "blocked", "sharing"];

// [file name in /press-kit/, source path below src/]
const brandFiles = [
  ["plainphone-logo.svg", "brand/lockup.svg"],
  ["plainphone-logo.png", "press/plainphone-logo.png"],
  ["plainphone-logo-dark.svg", "brand/lockup-dark.svg"],
  ["plainphone-logo-dark.png", "press/plainphone-logo-dark.png"],
  ["plainphone-mark.svg", "brand/mark.svg"],
  ["plainphone-mark.png", "press/plainphone-mark.png"],
  ["plainphone-mark-dark.svg", "brand/mark-dark.svg"],
  ["plainphone-mark-dark.png", "press/plainphone-mark-dark.png"],
  ["plainphone-app-icon.svg", "brand/app-icon.svg"],
  ["plainphone-app-icon.png", "press/plainphone-app-icon.png"],
];

// Everything that is written to /press-kit/, plus the zip. Returns [{ name, data }] relative to /press-kit/.
export function pressFiles(src) {
  const files = brandFiles.map(([name, from]) => ({ name, data: readFileSync(join(src, from)) }));
  const inZip = [
    ...files.map(({ name, data }) => ({ name: `logo/${name}`, data })),
    ...LANGS.map((lang) => ({ name: `share-image/plainphone-${lang}.png`, data: readFileSync(join(src, `og-${lang}.png`)) })),
    ...LANGS.flatMap((lang) => SHOTS.flatMap((shot) => ["light", "dark"].map((scheme) => ({
      name: `screenshots/${lang}/${shot}-${scheme}.webp`,
      data: readFileSync(join(src, "img", `${shot}-${lang}-${scheme}-2x.webp`)),
    })))),
    { name: "fonts/OFL.txt", data: readFileSync(join(src, "fonts", "OFL.txt")) },
  ];
  return [...files, { name: ZIP, data: zip(inZip) }];
}

const megabytes = (bytes, lang) =>
  `${new Intl.NumberFormat(lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(bytes / 1e6)} MB`;

const swatch = (hex) =>
  `<svg class="swatch" viewBox="0 0 48 48" aria-hidden="true" focusable="false"><rect x="0.75" y="0.75" width="46.5" height="46.5" rx="6" fill="${hex}" stroke="currentColor" stroke-width="1.5"/></svg>`;

// `picture` is the front page's <picture> helper, so the screenshots load the same way (lazy, light and dark).
export function pressContent(t, { esc, picture, github, zipSize }) {
  const p = press[t.lang];
  const shots = home[t.lang].shots;
  const file = (name, label) => `<a href="${KIT}/${name}" download>${label}</a>`;
  // The preview keeps its own light or dark background in both colour schemes; the caption follows the page.
  const tile = (name, label, dark = false) => `<figure class="kit-tile">
<div class="kit-preview${dark ? " on-dark" : ""}"><img src="${KIT}/${name}.svg" alt="" width="${name.includes("logo") ? 260 : 64}" height="64" loading="lazy" decoding="async"></div>
<figcaption><strong>${label}</strong><span class="kit-links">${file(`${name}.svg`, "SVG")}${file(`${name}.png`, "PNG")}</span></figcaption></figure>`;
  return `<h1>${p.h1}</h1>
<p class="lead">${p.lead}</p>
<p class="kit-zip"><a class="button" href="${KIT}/${ZIP}" download>${p.zip} (${megabytes(zipSize, t.lang)})</a></p>
<p class="note">${p.zipNote}</p>
<section aria-labelledby="describe"><h2 id="describe">${p.shortTitle}</h2><p class="copy">${p.short}</p>
<h2 id="paragraph">${p.longTitle}</h2><p class="copy">${p.long}</p></section>
<section aria-labelledby="facts"><h2 id="facts">${p.factsTitle}</h2>
<dl class="facts">${p.facts.map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`).join("")}
<div><dt>${p.links.code}</dt><dd><a href="${github}">github.com/plainphone/plainphone</a></dd></div>
<div><dt>${p.links.releases}</dt><dd><a href="${github}/releases">github.com/plainphone/plainphone/releases</a></dd></div>
</dl></section>
<section aria-labelledby="logo"><h2 id="logo">${p.assetsTitle}</h2><p>${p.assetsLead}</p>
<div class="kit-tiles">
${tile("plainphone-logo", p.assets.logo)}
${tile("plainphone-logo-dark", p.assets.logoDark, true)}
${tile("plainphone-mark", p.assets.mark)}
${tile("plainphone-mark-dark", p.assets.markDark, true)}
${tile("plainphone-app-icon", p.assets.icon)}
</div></section>
<section aria-labelledby="screenshots"><h2 id="screenshots">${p.shotsTitle}</h2><p>${p.shotsLead}</p>
<div class="kit-shots">${SHOTS.map((name) => `<figure class="shot">${picture(name, t.lang, shots[name].alt)}
<figcaption>${shots[name].caption}<span class="kit-links">${["light", "dark"].map((scheme) =>
    `<a href="/img/${name}-${t.lang}-${scheme}-2x.webp" download>${scheme === "light" ? p.light : p.dark}</a>`).join("")}</span></figcaption></figure>`).join("")}</div>
<h3>${p.ogTitle}</h3>
<figure class="kit-og"><img src="/og-${t.lang}.png" alt="${esc(p.ogAlt)}" width="600" height="315" loading="lazy" decoding="async">
<figcaption><span class="kit-links">${LANGS.map((lang) => `<a href="/og-${lang}.png" download hreflang="${lang}">${lang.toUpperCase()}</a>`).join("")}</span></figcaption></figure>
</section>
<section aria-labelledby="colours"><h2 id="colours">${p.coloursTitle}</h2>
<ul class="colours" role="list">${p.colours.map(([name, hex, use]) =>
    `<li>${swatch(hex)}<span><strong>${name}</strong> <code>${hex}</code><span class="desc">${use}</span></span></li>`).join("")}</ul>
<p>${p.fonts}</p></section>
<section aria-labelledby="contact"><h2 id="contact">${p.contactTitle}</h2>
<p>${p.contact} <a href="mailto:support@plainphone.org">support@plainphone.org</a></p></section>`;
}
