// SPDX-License-Identifier: Apache-2.0
// Dev-only: renders the brand directions in docs/brand/directions/{a,b,c}/.
// The output is committed; nothing in the product depends on this script.
//
//   node docs/brand/render.mjs --fonts             fetch the pinned OFL fonts into docs/brand/.cache
//   python3 docs/brand/tools/wordmarks.py          outline the wordmarks (needs fonttools)
//   NODE_PATH=<dir with playwright> node docs/brand/render.mjs
//
// The last step checks every contrast pair (it fails below WCAG 2.2 AA), writes
// the contrast tables into README.md, writes lockup SVGs and renders the PNGs.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const cache = join(here, ".cache", "fonts");

// google/fonts at a fixed commit, so a re-render uses the same outlines.
const FONT_REV = "cc5661d43cd4f9aad5567033a8e15ca28dc35c86";
const FONT_FILES = {
  "AtkinsonHyperlegibleNext[wght].ttf": "atkinsonhyperlegiblenext",
  "AtkinsonHyperlegibleMono[wght].ttf": "atkinsonhyperlegiblemono",
  "Figtree[wght].ttf": "figtree",
  "BricolageGrotesque[opsz,wdth,wght].ttf": "bricolagegrotesque",
  "SchibstedGrotesk[wght].ttf": "schibstedgrotesk",
  "IBMPlexMono-Regular.ttf": "ibmplexmono",
  "IBMPlexMono-Medium.ttf": "ibmplexmono",
};

async function fetchFonts() {
  mkdirSync(cache, { recursive: true });
  for (const [file, dir] of Object.entries(FONT_FILES)) {
    const target = join(cache, file);
    if (existsSync(target)) continue;
    const url = `https://raw.githubusercontent.com/google/fonts/${FONT_REV}/ofl/${dir}/${encodeURIComponent(file)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log(`fetched ${file}`);
  }
}

// ---------------------------------------------------------------------------
// The three directions. Token roles follow docs/design-tokens.md.

const ROLES = ["paper", "sheet", "ink", "pencil", "divider", "outline", "action", "onAction", "tint", "attention", "danger", "dangerFill", "brand", "onBrand"];

const directions = {
  a: {
    letter: "A",
    name: "Paper",
    idea: "Today's look, made consistent. Ink on paper, a pencil-grey second voice and one quiet green line. The mark is a phone outline with a single level line through it: the phone, minus the noise.",
    fonts: {
      display: { family: "Atkinson Hyperlegible Next", file: "AtkinsonHyperlegibleNext[wght].ttf", weight: 700 },
      body: { family: "Atkinson Hyperlegible Next", file: "AtkinsonHyperlegibleNext[wght].ttf", weight: 400 },
      mono: { family: "Atkinson Hyperlegible Mono", file: "AtkinsonHyperlegibleMono[wght].ttf", weight: 500 },
    },
    shape: { surface: 12, control: 10, track: "-0.02em", border: "1px" },
    light: { paper: "#f2f3ef", sheet: "#ffffff", ink: "#1c2321", pencil: "#4d5753", divider: "#dfe3df", outline: "#7a8580", action: "#24604a", onAction: "#ffffff", tint: "#e3efe8", attention: "#fbf1d9", danger: "#a3261d", dangerFill: "#fbe9e7", brand: "#24604a", onBrand: "#ffffff" },
    dark: { paper: "#121816", sheet: "#1b2320", ink: "#e8ece9", pencil: "#a9b3ae", divider: "#2c3833", outline: "#6b7873", action: "#7fc4a2", onAction: "#0d1a14", tint: "#22322b", attention: "#33301f", danger: "#f08a80", dangerFill: "#3a2321", brand: "#7fc4a2", onBrand: "#0d1a14" },
    brandNote: "Brand colour is the action green.",
  },
  b: {
    letter: "B",
    name: "Daylight",
    idea: "The phone follows the family's day: open in the daytime, quiet in the evening, a little more freedom each year. Night blue and a warm sun, soft round shapes. The mark is a phone whose screen shows the sun coming up; on dark it turns into an evening.",
    fonts: {
      display: { family: "Bricolage Grotesque", file: "BricolageGrotesque[opsz,wdth,wght].ttf", weight: 700 },
      body: { family: "Figtree", file: "Figtree[wght].ttf", weight: 400 },
      mono: { family: "Figtree", file: "Figtree[wght].ttf", weight: 600, tabular: true },
    },
    shape: { surface: 22, control: 14, track: "-0.025em", border: "0px" },
    light: { paper: "#f4f5f9", sheet: "#ffffff", ink: "#1b2240", pencil: "#4b5270", divider: "#e0e3ee", outline: "#7a809b", action: "#3446c4", onAction: "#ffffff", tint: "#e7eafb", attention: "#fdf0cc", danger: "#a8271d", dangerFill: "#fbe9e7", brand: "#f2b23a", onBrand: "#1b2240" },
    dark: { paper: "#10142a", sheet: "#1a2040", ink: "#eceefa", pencil: "#aab0cc", divider: "#2a3152", outline: "#6e7699", action: "#a8b3ff", onAction: "#12173a", tint: "#262e5c", attention: "#3a3220", danger: "#f28b82", dangerFill: "#3d2326", brand: "#f2b23a", onBrand: "#1b2240" },
    brandNote: "Brand colour is the sun. It is a fill for the mark, the day strip and highlights, never a text colour.",
  },
  c: {
    letter: "C",
    name: "Switch",
    idea: "Everything on a Plainphone is a choice someone can switch on or off. Graphite and white like a well-made tool, with one signal green that only means \"on\". The mark is an upright switch that is also a phone with one round button.",
    fonts: {
      display: { family: "Schibsted Grotesk", file: "SchibstedGrotesk[wght].ttf", weight: 700 },
      body: { family: "Schibsted Grotesk", file: "SchibstedGrotesk[wght].ttf", weight: 400 },
      mono: { family: "IBM Plex Mono", file: "IBMPlexMono-Medium.ttf", weight: 500 },
    },
    shape: { surface: 6, control: 999, track: "-0.03em", border: "1.5px" },
    light: { paper: "#f5f5f3", sheet: "#ffffff", ink: "#141414", pencil: "#525252", divider: "#e3e3e0", outline: "#767676", action: "#141414", onAction: "#ffffff", tint: "#eef8cf", attention: "#fff2c2", danger: "#b3261e", dangerFill: "#fde8e6", brand: "#c5f04a", onBrand: "#141414" },
    dark: { paper: "#0f0f0f", sheet: "#1b1b1b", ink: "#f2f2ef", pencil: "#b3b3ae", divider: "#2d2d2b", outline: "#7c7c78", action: "#c5f04a", onAction: "#141414", tint: "#27301a", attention: "#393217", danger: "#ff8a80", dangerFill: "#3e1f1d", brand: "#c5f04a", onBrand: "#141414" },
    brandNote: "Brand colour is the signal green. It is a fill for \"on\" states and the mark, with ink on top; in dark mode it is also the action colour.",
  },
};

// ---------------------------------------------------------------------------
// Contrast (WCAG 2.2 relative luminance).

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};

// [foreground, background, minimum, what it is]
const PAIRS = [
  ["ink", "paper", 4.5, "Body text"],
  ["ink", "sheet", 4.5, "Text on a sheet"],
  ["pencil", "paper", 4.5, "Secondary text"],
  ["pencil", "sheet", 4.5, "Secondary text on a sheet"],
  ["action", "paper", 4.5, "Links and focus ring"],
  ["action", "sheet", 4.5, "Links on a sheet"],
  ["onAction", "action", 4.5, "Text on a filled button"],
  ["outline", "sheet", 3, "Control outline"],
  ["outline", "paper", 3, "Control outline on paper"],
  ["ink", "tint", 4.5, "Text on a selected row"],
  ["action", "tint", 4.5, "Action on a selected row"],
  ["ink", "attention", 4.5, "Text on an attention fill"],
  ["danger", "sheet", 4.5, "Danger text"],
  ["danger", "dangerFill", 4.5, "Danger text on danger fill"],
];
const BRAND_PAIRS = {
  a: [["onBrand", "brand", 4.5, "White on the brand green (icons)"]],
  b: [["onBrand", "brand", 4.5, "Night ink on the sun (mark, highlights)"], ["brand", "paper", null, "Sun on paper (decorative only)"]],
  c: [["onBrand", "brand", 4.5, "Ink on signal green (\"on\" fill)"], ["brand", "paper", null, "Signal green on paper (fill only, with an ink edge)"]],
};

function contrastTable(key) {
  const d = directions[key];
  const rows = [];
  const failures = [];
  for (const [fg, bg, min, label] of [...PAIRS, ...BRAND_PAIRS[key]]) {
    const cells = ["light", "dark"].map((mode) => {
      const r = ratio(d[mode][fg], d[mode][bg]);
      if (min && r < min) failures.push(`${d.letter} ${mode} ${fg}/${bg} ${r.toFixed(2)} < ${min}`);
      return `${r.toFixed(2)}`;
    });
    rows.push(`| ${label} | \`${fg}\` on \`${bg}\` | ${cells[0]} | ${cells[1]} | ${min ? `${min}:1` : "none, not text"} |`);
  }
  const table = ["| Pair | Roles | Light | Dark | Needs |", "| --- | --- | --- | --- | --- |", ...rows].join("\n");
  return { table, failures };
}

function paletteTable(key) {
  const d = directions[key];
  const rows = ROLES.map((r) => `| ${r} | \`${d.light[r]}\` | \`${d.dark[r]}\` |`);
  return ["| Role | Light | Dark |", "| --- | --- | --- |", ...rows].join("\n");
}

function updateReadme() {
  const path = join(here, "README.md");
  let md = readFileSync(path, "utf8");
  const failures = [];
  for (const key of Object.keys(directions)) {
    const { table, failures: f } = contrastTable(key);
    failures.push(...f);
    for (const [tag, body] of [[`palette:${key}`, paletteTable(key)], [`contrast:${key}`, table]]) {
      const re = new RegExp(`(<!-- ${tag} -->\\n)[\\s\\S]*?(<!-- /${tag} -->)`);
      if (!re.test(md)) throw new Error(`README.md: missing <!-- ${tag} --> markers`);
      md = md.replace(re, (_, open, close) => `${open}${body}\n${close}`);
    }
  }
  if (failures.length) throw new Error(`Contrast below WCAG 2.2 AA:\n${failures.join("\n")}`);
  writeFileSync(path, md);
  console.log("README.md: palettes and contrast tables updated, every pair passes");
}

// ---------------------------------------------------------------------------
// SVG helpers.

const read = (key, file) => readFileSync(join(here, "directions", key, file), "utf8");
const inner = (svg) => svg.replace(/<!--[\s\S]*?-->/g, "").replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").trim();

function wordmark(key) {
  const svg = read(key, "wordmark.svg");
  const [x, y, w, h] = svg.match(/viewBox="([^"]+)"/)[1].split(" ").map(Number);
  const d = svg.match(/ d="([^"]+)"/)[1];
  return { x, y, w, h, d };
}

/** Mark + wordmark on one line, 64 units high. */
function lockup(key, mode) {
  const d = directions[key];
  const m = inner(read(key, mode === "dark" ? "mark-dark.svg" : "mark.svg"));
  const wm = wordmark(key);
  const height = 34;
  const s = height / wm.h;
  const gap = 14;
  const width = 64 + gap + wm.w * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(1)} 64" role="img" aria-label="Plainphone">
  ${m}
  <path fill="${d[mode].ink}" transform="translate(${64 + gap} ${((64 - height) / 2).toFixed(2)}) scale(${s.toFixed(5)}) translate(${-wm.x} ${-wm.y})" d="${wm.d}"/>
</svg>
`;
}

// ---------------------------------------------------------------------------
// HTML for the mocks and the overview.

const fontCache = new Map();
function fontFace(f) {
  if (!fontCache.has(f.file)) fontCache.set(f.file, readFileSync(join(cache, f.file)).toString("base64"));
  const stretch = f.file.startsWith("Bricolage") ? "font-stretch:75% 100%;" : "";
  const weight = f.file.includes("[") ? "200 900" : String(f.weight);
  return `@font-face{font-family:"${f.family}";src:url(data:font/ttf;base64,${fontCache.get(f.file)}) format("truetype");font-weight:${weight};${stretch}}`;
}

function css(key, mode) {
  const d = directions[key];
  const t = d[mode];
  const faces = [...new Map(Object.values(d.fonts).map((f) => [f.file, f])).values()].map(fontFace).join("");
  const vars = ROLES.map((r) => `--${r}:${t[r]};`).join("");
  return `${faces}
:root{${vars}--edge:${mode === "light" ? t.ink : t.brand};--r:${d.shape.surface}px;--rc:${d.shape.control}px;--bw:${d.shape.border};--track:${d.shape.track};
--display:"${d.fonts.display.family}",system-ui,sans-serif;--body:"${d.fonts.body.family}",system-ui,sans-serif;--mono:"${d.fonts.mono.family}",ui-monospace,monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:var(--body);color:var(--ink);background:var(--paper);-webkit-font-smoothing:antialiased}
.num{font-family:var(--mono);font-weight:${d.fonts.mono.weight};font-variant-numeric:tabular-nums}
h1,h2,h3{font-family:var(--display);letter-spacing:var(--track);font-weight:${d.fonts.display.weight};line-height:1.05}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:var(--rc);font-weight:650;font-size:17px;text-decoration:none;border:2px solid transparent}
.btn.primary{background:var(--action);color:var(--onAction)}
.btn.ghost{border-color:var(--outline);color:var(--ink);background:transparent}
.btn.small{min-height:44px;font-size:16px;padding:0 16px}
.toggle{flex:none;width:52px;height:32px;border-radius:16px;position:relative;border:2px solid var(--outline);background:var(--sheet)}
.toggle::after{content:"";position:absolute;top:4px;left:4px;width:20px;height:20px;border-radius:50%;background:var(--outline)}
.toggle.on{background:var(--action);border-color:var(--action)}
.toggle.on::after{left:24px;background:var(--onAction)}
${key === "b" ? `h1,h2,h3{font-variation-settings:"opsz" 48}` : ""}
${key === "c" ? `.toggle.on{background:var(--brand);border-color:var(--ink)}.toggle.on::after{background:#141414}
.toggle{border-width:2px}` : ""}
`;
}

const ICON = {
  phone: `<path d="M6.5 3.5h2.8l1.6 4.2-2.1 1.3a10.5 10.5 0 0 0 6.2 6.2l1.3-2.1 4.2 1.6v2.8a2 2 0 0 1-2.2 2A16 16 0 0 1 4.5 5.7a2 2 0 0 1 2-2.2z"/>`,
  sms: `<path d="M4 5h16v11H10l-6 4z"/>`,
  camera: `<rect x="3" y="7" width="18" height="13" rx="2"/><circle cx="12" cy="13.5" r="3.5"/><path d="M8.5 7l1.5-3h4l1.5 3"/>`,
  map: `<path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14"/>`,
  music: `<path d="M9 18V5l11-2v13"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>`,
  clock: `<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>`,
};
const icon = (name, size = 24) =>
  `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[name]}</svg>`;

function heroArt(key) {
  if (key === "a") {
    return `<div class="art-a">
      <p class="lbl">Det beholder du</p>
      <ul><li>Opkald</li><li>Sms</li><li>Kamera</li><li>De apps, du vælger</li></ul>
      <p class="lbl">Det kan du slå fra</p>
      <ul class="off"><li>Sociale medier og spil</li><li>Udvalgte hjemmesider</li><li>App-butikker</li></ul>
    </div>`;
  }
  if (key === "b") {
    const seg = (from, to, cls, label) => `<div class="seg ${cls}" style="left:${((from - 6) / 18) * 100}%;width:${((to - from) / 18) * 100}%"><span>${label}</span></div>`;
    return `<div class="art-b">
      <svg class="sun" viewBox="0 0 200 128" aria-hidden="true"><path d="M40 84a60 60 0 0 1 120 0z" fill="var(--brand)"/><rect x="40" y="96" width="120" height="12" rx="6" fill="var(--brand)"/><rect x="70" y="116" width="60" height="12" rx="6" fill="var(--brand)"/></svg>
      <div class="day">
        <div class="strip">${seg(6, 8, "free", "")}${seg(8, 14, "school", "Skole")}${seg(14, 20, "free", "Fri")}${seg(20, 24, "quiet", "Ro")}<i class="now" style="left:${((14.5 - 6) / 18) * 100}%"></i></div>
        <div class="ticks num"><span>06</span><span>12</span><span>18</span><span>24</span></div>
      </div>
      <p class="cap">Telefonen følger jeres dag. Opkald til mor og far virker altid.</p>
    </div>`;
  }
  const row = (label, on) => `<li><span>${label}</span><i class="toggle${on ? " on" : ""}"></i></li>`;
  return `<div class="art-c"><ul>${row("Opkald", true)}${row("Sms", true)}${row("Kamera", true)}${row("Kort", true)}${row("Sociale medier", false)}${row("App-butik", false)}</ul>
    <p class="cap">Du bestemmer, hvad der er tændt.</p></div>`;
}

function hero(key, mode) {
  const d = directions[key];
  return `<section class="hero">
  <nav><span class="lock">${lockup(key, mode)}</span><span class="links"><a>Hvorfor</a><a>Opsætning</a><a>Apps</a><b>DA</b></span></nav>
  <div class="hb">
    <div class="copy">
      <h1>Din telefon,<br><span class="hl">uden støjen.</span></h1>
      <p class="lead">Plainphone gør en Android-telefon til en telefon med opkald, sms og de apps, du selv vælger.</p>
      <div class="ctas"><a class="btn primary">Kom i gang</a><a class="btn ghost">Hvem er den til?</a></div>
      <p class="note">Gratis og open source. Du kan selv drive serveren.</p>
    </div>
    ${heroArt(key)}
  </div>
</section>
<style>
.hero{width:960px;height:560px;padding:28px 48px 40px;background:var(--paper);display:flex;flex-direction:column;gap:56px}
.hero nav{display:flex;justify-content:space-between;align-items:center}
.hero .lock svg{height:34px;width:auto;display:block}
.hero .links{display:flex;gap:28px;font-size:16px;color:var(--ink)}
.hero .links b{font-weight:650;border:var(--bw) solid var(--outline);padding:2px 8px;border-radius:6px}
.hero .hb{display:flex;gap:48px;align-items:center}
.hero .copy{flex:1.25}
.hero h1{font-size:62px;margin-bottom:22px}
.hero .lead{font-size:19px;line-height:1.5;color:var(--pencil);max-width:30em;margin-bottom:28px}
.hero .ctas{display:flex;gap:12px;margin-bottom:18px}
.hero .note{font-size:15px;color:var(--pencil)}
${key === "a" ? `.hero .hl{background:linear-gradient(transparent 78%,var(--tint) 78%,var(--tint) 94%,transparent 94%)}
.art-a{flex:1;background:var(--sheet);border:1px solid var(--divider);border-radius:var(--r);padding:24px 26px}
.art-a .lbl{font-size:14px;font-weight:650;color:var(--pencil);margin-bottom:6px}
.art-a ul{list-style:none;margin-bottom:18px}.art-a ul:last-child{margin:0}
.art-a li{font-size:17px;padding:9px 0;border-bottom:1px solid var(--divider);display:flex;gap:10px;align-items:center}
.art-a li::before{content:"";width:12px;height:3px;border-radius:2px;background:var(--action)}
.art-a ul.off li{color:var(--pencil)}.art-a ul.off li::before{background:var(--outline);width:12px}` : ""}
${key === "b" ? `.hero{gap:44px}.hero .hl{color:var(--action)}
.art-b{flex:1;background:var(--sheet);border-radius:var(--r);padding:26px 26px 22px;position:relative;overflow:hidden}
.art-b .sun{width:170px;display:block;margin:0 auto -2px}
.art-b .day{padding-top:18px}
.art-b .strip{position:relative;height:44px;border-radius:12px;background:var(--paper);overflow:hidden}
.art-b .seg{position:absolute;top:0;bottom:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:650}
.art-b .school{background:var(--tint);color:var(--ink)}.art-b .quiet{background:${mode === "light" ? "var(--ink)" : "#070a18"};color:${mode === "light" ? "var(--paper)" : "var(--ink)"}}
.art-b .now{position:absolute;top:-2px;bottom:-2px;width:3px;background:var(--action);border-radius:2px}
.art-b .ticks{display:flex;justify-content:space-between;font-size:13px;color:var(--pencil);margin-top:6px}
.art-b .cap{font-size:16px;line-height:1.45;margin-top:14px}` : ""}
${key === "c" ? `.hero .hl{box-shadow:inset 0 -0.22em 0 var(--brand)}${mode === "dark" ? ".hero .hl{box-shadow:none;color:var(--brand)}" : ""}
.art-c{flex:1;background:var(--sheet);border:var(--bw) solid var(--ink);border-radius:var(--r);padding:8px 22px 18px}
.art-c ul{list-style:none}
.art-c li{display:flex;justify-content:space-between;align-items:center;padding:11px 0;border-bottom:1px solid var(--divider);font-size:17px;font-weight:500}
.art-c .cap{font-family:var(--mono);font-size:14px;margin-top:14px;color:var(--pencil)}` : ""}
</style>`;
}

function card(key, mode) {
  const d = directions[key];
  const row = (title, sub, on) => `<li><div><b>${title}</b><span>${sub}</span></div><i class="toggle${on ? " on" : ""}" role="switch" aria-checked="${on}"></i></li>`;
  return `<section class="card">
  <header><h2>Sams telefon</h2><p class="status"><i class="dot"></i>Online for 2 min. siden · reglerne er nået frem</p></header>
  <ul>
    ${row("Skoletid", `Hverdage <span class="num">08.00–14.00</span>`, true)}
    ${row("Webfilter", "Blokerer voksenindhold og reklamer", true)}
    ${row("Placering", "Kun når du spørger. Sam kan se det.", false)}
  </ul>
  <div class="ask"><p><b>Sam spørger om 30 min. mere til Kort i dag.</b></p><div class="acts"><a class="btn primary small">Giv 30 min.</a><a class="btn ghost small">Ikke i dag</a></div></div>
</section>
<style>
.card{width:420px;background:var(--sheet);border-radius:var(--r);padding:22px 22px 20px;${key === "c" ? "border:var(--bw) solid var(--ink);" : key === "a" ? "border:1px solid var(--divider);" : ""}}
.card h2{font-size:26px;margin-bottom:6px}
.card .status{font-size:15px;color:var(--pencil);display:flex;align-items:center;gap:8px;margin-bottom:12px}
.card .dot{width:10px;height:10px;border-radius:50%;background:${key === "c" ? "var(--brand)" : "var(--action)"};${key === "c" ? "box-shadow:0 0 0 1.5px var(--ink)" : ""}}
.card ul{list-style:none;margin-bottom:16px}
.card li{display:flex;justify-content:space-between;align-items:center;gap:16px;padding:12px 0;border-top:1px solid var(--divider)}
.card li b{display:block;font-size:17px;font-weight:650;margin-bottom:2px}
.card li span{font-size:15px;color:var(--pencil)}
.card .ask{background:var(--attention);border-radius:calc(var(--r) * .7);padding:14px 16px}
.card .ask p{font-size:16px;line-height:1.4;margin-bottom:12px}.card .ask b{font-weight:600}
.card .acts{display:flex;gap:10px}
.card .ask .btn.ghost{background:var(--sheet)}
</style>`;
}

function home(key, mode) {
  const d = directions[key];
  const apps = [["phone", "Telefon"], ["sms", "Beskeder"], ["camera", "Kamera"], ["map", "Kort"], ["music", "Musik"], ["clock", "Ur"]];
  return `<section class="phone"><div class="scr">
  <div class="sb num"><span>14.32</span><span>4G ▮▮▮ 82 %</span></div>
  <p class="clock num">14.32</p><p class="date">Torsdag 19. november</p>
  <p class="rule">Skoletid til <span class="num">14.00</span>. Opkald og sms virker.</p>
  <div class="calls"><a class="call">${icon("phone", 22)}Ring til Mor</a><a class="call">${icon("phone", 22)}Ring til Far</a></div>
  <ul class="apps">${apps.map(([i, n]) => `<li>${icon(i, key === "b" ? 26 : 22)}<span>${n}</span></li>`).join("")}</ul>
  <p class="sos">Nødopkald <b class="num">112</b></p>
</div></section>
<style>
.phone{width:320px;height:660px;border-radius:44px;padding:10px;background:#111;}
.phone .scr{height:100%;border-radius:36px;background:var(--paper);padding:14px 20px 18px;display:flex;flex-direction:column;overflow:hidden}
.phone .sb{display:flex;justify-content:space-between;font-size:12px;color:var(--pencil);margin-bottom:22px}
.phone .clock{font-size:56px;line-height:1;font-family:var(--display);font-weight:${key === "c" ? 500 : 650};letter-spacing:-0.02em}
.phone .clock.num{font-family:${key === "c" ? "var(--mono)" : "var(--display)"}}
.phone .date{font-size:16px;color:var(--pencil);margin:6px 0 14px}
.phone .rule{font-size:15px;line-height:1.35;padding:10px 12px;border-radius:calc(var(--r) * .6);background:var(--tint);margin-bottom:14px}
.phone .calls{display:flex;flex-direction:column;gap:8px;margin-bottom:12px}
.phone .call{display:flex;align-items:center;gap:12px;min-height:52px;padding:0 16px;border-radius:var(--rc);background:var(--action);color:var(--onAction);font-size:18px;font-weight:650}
.phone .apps{list-style:none;flex:1}
.phone .sos{font-size:15px;text-align:center;color:var(--pencil)}.phone .sos b{color:var(--danger)}
${key === "a" ? `.phone .call{border-radius:10px}
.phone .apps li{display:flex;align-items:center;gap:14px;font-size:17px;padding:8px 2px;border-bottom:1px solid var(--divider)}.phone .apps .ic{color:var(--pencil)}` : ""}
${key === "b" ? `.phone .call{border-radius:18px}.phone .rule{background:var(--attention)}
.phone .apps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px 6px;align-content:start;padding-top:4px}
.phone .apps li{display:flex;flex-direction:column;align-items:center;gap:6px;font-size:13px;font-weight:600}
.phone .apps .ic{box-sizing:content-box;padding:13px;border-radius:18px;background:var(--sheet);color:var(--action)}` : ""}
${key === "c" ? `.phone .call{border-radius:999px}
.phone .rule{background:var(--sheet);border:1.5px solid var(--ink);border-radius:6px;font-family:var(--mono);font-size:13px}
.phone .apps li{display:flex;align-items:center;gap:14px;font-size:17px;font-weight:500;padding:8px 0;border-bottom:1.5px solid var(--divider)}` : ""}
</style>`;
}

function mocksPage(key, mode) {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><style>${css(key, mode)}
body{padding:0;background:transparent}.row{display:flex;gap:32px;align-items:flex-start;padding:32px;background:${mode === "light" ? "#e4e4e0" : "#050505"}}
.col{display:flex;flex-direction:column;gap:24px}</style></head><body><div class="row" id="shot">
${hero(key, mode)}<div class="col">${card(key, mode)}</div>${home(key, mode)}</div></body></html>`;
}

function pageFor(key, mode, body, extraCss = "") {
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><style>${css(key, mode)}${extraCss}</style></head><body>${body}</body></html>`;
}

function overview(key, svgs) {
  const d = directions[key];
  const L = d.light;
  const D = d.dark;
  const swatches = (mode) => ROLES.map((r) => {
    const c = d[mode][r];
    const fg = luminance(c) > 0.3 ? "#141414" : "#ffffff";
    const vs = ["paper", "sheet", "tint", "attention", "dangerFill", "brand", "onBrand", "onAction"].includes(r) ? "" : `${ratio(c, d[mode].paper).toFixed(1)}:1`;
    return `<div class="sw" style="background:${c};color:${fg}"><b>${r}</b><span>${c}</span><span>${vs}</span></div>`;
  }).join("");
  const img = (svg, size, extra = "") => `<span class="ico" style="width:${size}px;height:${size}px;${extra}">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</span>`;
  const fonts = d.fonts;
  const body = `<div class="ov">
  <header><p class="tag">Retning ${d.letter}</p><h1>${d.name}</h1><p class="idea">${d.idea}</p></header>
  <div class="r1">
    <div class="pan" style="background:${L.paper}"><p class="cap" style="color:${L.pencil}">Logo, lys</p><div class="lockbig">${lockup(key, "light")}</div><div class="marks">${img(svgs.mark, 96)}${img(svgs.mark, 48)}${img(svgs.mark, 24)}</div></div>
    <div class="pan" style="background:${D.paper}"><p class="cap" style="color:${D.pencil}">Logo, mørk</p><div class="lockbig">${lockup(key, "dark")}</div><div class="marks">${img(svgs.markDark, 96)}${img(svgs.markDark, 48)}${img(svgs.markDark, 24)}</div></div>
    <div class="pan icons" style="background:#ffffff">
      <p class="cap">Ikoner i faktisk størrelse</p>
      <div class="tabs"><div class="tab lt">${img(svgs.fav16, 16)}<span>Plainphone</span></div><div class="tab dk">${img(svgs.fav16, 16)}<span>Plainphone</span></div><div class="tab lt">${img(svgs.fav, 32)}<span>32 px</span></div></div>
      <div class="big">
        <figure>${img(svgs.app, 180, "border-radius:40px;overflow:hidden")}<figcaption>180 · apple-touch</figcaption></figure>
        <figure>${img(svgs.maskable, 180, "border-radius:50%;overflow:hidden")}<figcaption>512 maskable, rund maske</figcaption></figure>
        <figure><span class="ico adapt" style="width:180px;height:180px">${svgs.adaptBg.replace("<svg ", '<svg width="180" height="180" ')}${svgs.adaptFg.replace("<svg ", '<svg width="180" height="180" ')}</span><figcaption>Android adaptiv</figcaption></figure>
        <figure><span class="ico mono" style="width:180px;height:180px">${svgs.adaptMono.replace("<svg ", '<svg width="180" height="180" ')}</span><figcaption>Android tema-ikon</figcaption></figure>
      </div>
      <div class="notif"><span class="bar">${img(svgs.notif, 24)}<span>14.32</span></span>${img(svgs.notif, 72, "background:#3c4043;border-radius:12px;padding:10px;box-sizing:content-box")}<figcaption>Notifikationsikon, 24 dp og forstørret</figcaption></div>
    </div>
  </div>
  <div class="r2">
    <div class="pan pal" style="background:#ffffff"><p class="cap">Farver, lys og mørk (kontrast mod paper)</p><div class="sws">${swatches("light")}</div><div class="sws">${swatches("dark")}</div><p class="foot">${d.brandNote}</p></div>
    <div class="pan type" style="background:${L.sheet};color:${L.ink}">
      <p class="cap" style="color:${L.pencil}">Skrift</p>
      <p class="t-display">Din telefon, uden støjen.</p>
      <p class="t-body">Sam kan ringe til mor og far hele tiden. Skoletid gælder på hverdage, og Sam kan se reglerne på sin egen telefon. Æble, øre, ål. Größe, Bläck, Søknad.</p>
      <p class="t-mono num">08.00–14.00 · Kode 482 913 · 112</p>
      <p class="t-meta" style="color:${L.pencil}">${fonts.display.family} ${fonts.display.weight} til overskrifter · ${fonts.body.family} ${fonts.body.weight} til brødtekst · ${fonts.mono.family}${fonts.mono.tabular ? " med tabeltal" : ""} til tider og koder. Alle SIL OFL 1.1.</p>
    </div>
  </div>
  <div class="r3"><p class="cap">Mock: forside, kort i dashboardet (lys og mørk) og telefonens startskærm</p>
    <div class="mocks">
      <div class="m-hero">${hero(key, "light")}</div>
      <div class="m-cards"><div class="theme-l">${card(key, "light")}</div><div class="theme-d">${card(key, "dark")}</div></div>
      <div class="m-phone theme-l">${home(key, "light")}</div>
      <div class="m-phone theme-d">${home(key, "dark")}</div>
    </div>
  </div>
</div>`;
  const darkVars = ROLES.map((r) => `--${r}:${D[r]};`).join("") + `--edge:${D.brand};`;
  const extra = `
body{background:#d9d9d4;width:2300px}
.ov{padding:56px;display:flex;flex-direction:column;gap:28px}
header .tag{font-size:18px;font-weight:650;color:#555}
header h1{font-size:72px;margin:4px 0 12px;color:#141414}
header .idea{font-size:22px;line-height:1.45;max-width:62em;color:#2a2a2a}
.pan{border-radius:16px;padding:24px 28px;position:relative}
.cap{font-size:15px;font-weight:650;color:#555;margin-bottom:16px}
.r1{display:grid;grid-template-columns:1fr 1fr 1.35fr;gap:24px}
.lockbig svg{height:72px;width:auto;display:block;margin:28px 0 36px}
.marks{display:flex;gap:28px;align-items:flex-end}
.ico{display:inline-block;flex:none;position:relative}.ico svg{display:block}
.adapt svg{position:absolute;inset:0;border-radius:50%}
.mono{background:#e6e1f5;border-radius:50%;color:#3b2f73}.mono svg path,.mono svg rect,.mono svg circle{fill:#3b2f73;stroke:#3b2f73}
.mono svg [fill="none"]{fill:none}
.tabs{display:flex;gap:10px;margin-bottom:20px;align-items:center}
.tab{display:flex;gap:8px;align-items:center;padding:8px 14px;border-radius:10px 10px 0 0;font:13px system-ui,sans-serif}
.tab.lt{background:#eceef1;color:#222}.tab.dk{background:#35363a;color:#eee}
.big{display:flex;gap:22px;flex-wrap:wrap}
figure{display:flex;flex-direction:column;gap:8px;align-items:flex-start}
figcaption{font:13px system-ui,sans-serif;color:#555}
.notif{display:flex;gap:18px;align-items:center;margin-top:20px}
.notif .bar{display:flex;gap:8px;align-items:center;background:#202124;color:#fff;font:13px system-ui;padding:6px 12px;border-radius:8px}
.r2{display:grid;grid-template-columns:1.35fr 1fr;gap:24px}
.sws{display:grid;grid-template-columns:repeat(14,1fr);gap:6px;margin-bottom:8px}
.sw{height:118px;border-radius:8px;padding:8px;display:flex;flex-direction:column;justify-content:flex-end;font:11.5px/1.35 system-ui,sans-serif;box-shadow:inset 0 0 0 1px rgba(0,0,0,.12)}
.sw b{font-weight:650;margin-bottom:auto}
.foot{font:14px system-ui,sans-serif;color:#555;margin-top:8px}
.t-display{font-family:var(--display);font-weight:${fonts.display.weight};letter-spacing:var(--track);font-size:56px;line-height:1.05;margin-bottom:16px${key === "b" ? ';font-variation-settings:"opsz" 48' : ""}}
.t-body{font-size:19px;line-height:1.5;margin-bottom:12px;max-width:36em}
.t-mono{font-size:22px;margin-bottom:14px}
.t-meta{font-size:14px;line-height:1.5}
.r3 .mocks{display:flex;gap:24px;align-items:flex-start}
.m-hero{border-radius:16px;overflow:hidden;flex:none}
.m-cards{display:flex;flex-direction:column;gap:24px}
.theme-d{${darkVars}color:var(--ink)}
.theme-d .card{background:var(--sheet)}
`;
  return pageFor(key, "light", body, extra);
}

// ---------------------------------------------------------------------------

async function render() {
  for (const file of Object.keys(FONT_FILES)) {
    if (!existsSync(join(cache, file))) await fetchFonts();
  }
  updateReadme();

  const require = createRequire(import.meta.url);
  const { chromium } = require("playwright");
  const browser = await chromium.launch({ chromiumSandbox: true });
  const page = await browser.newPage({ deviceScaleFactor: 1 });

  const shotSvg = async (svg, size, out, bg = "transparent") => {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><style>html,body{margin:0;background:${bg}}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
    writeFileSync(out, await page.screenshot({ type: "png", omitBackground: bg === "transparent" }));
  };

  for (const key of Object.keys(directions)) {
    const dir = join(here, "directions", key);
    const prev = join(dir, "preview");
    mkdirSync(prev, { recursive: true });
    writeFileSync(join(dir, "lockup.svg"), lockup(key, "light"));
    writeFileSync(join(dir, "lockup-dark.svg"), lockup(key, "dark"));

    const svgs = {
      mark: read(key, "mark.svg"), markDark: read(key, "mark-dark.svg"), fav: read(key, "favicon.svg"), fav16: read(key, "favicon-16.svg"),
      app: read(key, "app-icon.svg"), maskable: read(key, "maskable.svg"), adaptBg: read(key, "adaptive-background.svg"),
      adaptFg: read(key, "adaptive-foreground.svg"), adaptMono: read(key, "adaptive-monochrome.svg"), notif: read(key, "notification.svg"),
    };

    // Icons at the sizes they ship in.
    await shotSvg(svgs.fav16, 16, join(prev, "favicon-16.png"));
    await shotSvg(svgs.fav, 32, join(prev, "favicon-32.png"));
    await shotSvg(svgs.app, 180, join(prev, "apple-touch-icon-180.png"));
    await shotSvg(svgs.app, 512, join(prev, "icon-512.png"));
    await shotSvg(svgs.maskable, 512, join(prev, "maskable-512.png"));
    await shotSvg(svgs.notif, 96, join(prev, "notification-96.png"), "#3c4043");
    await page.setViewportSize({ width: 432, height: 432 });
    await page.setContent(`<!doctype html><style>html,body{margin:0}div{position:relative;width:432px;height:432px;border-radius:50%;overflow:hidden}svg{position:absolute;inset:0;width:432px;height:432px}</style><div>${svgs.adaptBg}${svgs.adaptFg}</div>`);
    writeFileSync(join(prev, "adaptive-432.png"), await page.screenshot({ type: "png", omitBackground: true }));

    // Logo on paper, light and dark.
    for (const mode of ["light", "dark"]) {
      await page.setViewportSize({ width: 900, height: 260 });
      await page.setContent(pageFor(key, mode, `<div style="width:900px;height:260px;display:flex;align-items:center;justify-content:center;background:var(--paper)">${lockup(key, mode).replace("<svg ", '<svg style="height:96px;width:auto" ')}</div>`));
      writeFileSync(join(prev, `logo-${mode}.png`), await page.screenshot({ type: "png" }));

      await page.setViewportSize({ width: 1900, height: 800 });
      await page.setContent(mocksPage(key, mode));
      await page.evaluate(() => document.fonts.ready);
      writeFileSync(join(prev, `mocks-${mode}.png`), await page.locator("#shot").screenshot({ type: "png" }));
    }

    await page.setViewportSize({ width: 2300, height: 1200 });
    await page.setContent(overview(key, svgs));
    await page.evaluate(() => document.fonts.ready);
    writeFileSync(join(dir, "overview.png"), await page.screenshot({ type: "png", fullPage: true }));
    console.log(`rendered direction ${key}`);
  }
  await browser.close();
}

if (process.argv.includes("--fonts")) await fetchFonts();
else if (process.argv.includes("--check")) {
  // Contrast only, no browser: node docs/brand/render.mjs --check
  updateReadme();
} else await render();
