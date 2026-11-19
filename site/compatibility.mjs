// SPDX-License-Identifier: Apache-2.0
import { readdirSync, readFileSync } from "node:fs";

const catalogDir = new URL("../server/catalog/", import.meta.url);
const catalogs = readdirSync(catalogDir)
  .filter((file) => /^[a-z]{2}\.json$/.test(file))
  .map((file) => JSON.parse(readFileSync(new URL(file, catalogDir), "utf8")));

// A selection of representative hostnames from dns/tests/test_e2e.py and
// dns/ppdns/lists.py. This reference is deliberately smaller than the live filter.
const domains = [
  ["Dailymotion", "dailymotion.com", "video"],
  ["Instagram", "instagram.com", "social"],
  ["OnlyFans", "onlyfans.com", "adult"],
  ["Roblox", "www.roblox.com", "games"],
  ["Snapchat", "snapchat.com", "social"],
  ["Steam", "steampowered.com", "games"],
  ["TikTok", "tiktok.com", "social"],
  ["Tinder", "tinder.com", "dating"],
  ["Twitch", "twitch.tv", "video"],
  ["Vimeo", "vimeo.com", "video"],
  ["YouTube", "www.youtube.com", "youtube"],
  ["YouTube", "m.youtube.com", "youtube"],
  ["YouTube", "youtubei.googleapis.com", "youtube"],
  ["YouTube", "youtube.googleapis.com", "youtube"],
  ["YouTube", "www.youtube-nocookie.com", "youtube"],
  ["bet365", "bet365.com", "gambling"],
  ["Google ads", "googlesyndication.com", "tracking"],
  ["Sundhed.dk", "sundhed.dk", "help"],
];

export function compatibilityContent(t, esc) {
  const p = t.compatibility;
  const entry = (title, identifier, detail, aliases = []) => `<li data-search="${esc([title, identifier, ...aliases].join("\n"))}">
<strong>${esc(title)}</strong> <span class="note">${esc(identifier)}</span>
<span>${esc(detail)}</span>
</li>`;

  const section = (id, title, rows, empty) => `<section aria-labelledby="${id}" data-results>
<h2 id="${id}">${title}</h2>
<ul class="compatibility-list">${rows.join("\n")}</ul>
<p role="status" class="note"><span data-empty hidden>${empty}</span></p>
</section>`;

  const apps = catalogs.flatMap((catalog) => {
    const localized = (name) => name[t.lang] ?? name.en;
    const categories = new Map(catalog.categories.map(({ id, name }) => [id, localized(name)]));
    return catalog.apps.map((app) => entry(
      app.name,
      app.packageName,
      `${localized(catalog.name)} · ${categories.get(app.category)}`,
      [app.playTitle],
    ));
  });

  const websites = domains.map(([name, host, category]) => entry(
    name, host, p.filters[category],
  ));

  return `<h1>${p.title}</h1>
<p class="lead">${p.lead}</p>
<div class="compatibility-search" hidden>
<label for="app-search">${p.label}</label>
<input type="search" id="app-search" aria-describedby="search-help" autocomplete="off" spellcheck="false">
<p class="note" id="search-help">${p.hint}</p>
</div>
${section("catalog", p.catalog, apps, p.noApps)}
${section("websites", p.websites, websites, p.noWebsites)}
<p class="note">${p.limits}</p>`;
}
