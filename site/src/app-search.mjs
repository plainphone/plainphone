// SPDX-License-Identifier: Apache-2.0
const fold = (value) => value.toLowerCase().replace(/\s+/g, " ").trim();

export function matches(terms, query) {
  let needle = fold(query);
  if (!needle) return true;
  // A dotted query that is not a URL may be a domain still being typed
  // ("youtube.c"), so it may match the start of a domain.
  const isUrl = /^(?:https?:\/\/|[^\s/]+\.\w+\/)/.test(needle);
  const partial = !isUrl;
  if (isUrl) {
    try {
      const url = new URL(needle.includes("://") ? needle : `https://${needle}`);
      needle = url.hostname === "play.google.com" && url.pathname === "/store/apps/details"
        ? (url.searchParams.get("id") || url.hostname)
        : url.hostname;
    } catch {
      return false;
    }
  }
  const values = terms.split("\n").map(fold);
  if (!needle.includes(".")) return values.some((value) => value.includes(needle));
  const bare = (value) => value.replace(/^www\./, "").replace(/\.$/, "");
  const identifier = bare(needle);
  return values.some((value) => {
    const candidate = bare(value);
    return candidate === identifier || candidate.startsWith(`${identifier} (`) ||
      (partial && candidate.startsWith(identifier));
  });
}

if (typeof document !== "undefined") {
  // Escape closes an open menu or language list and returns focus to its button.
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = document.querySelector("details.pop[open]");
    if (!open) return;
    open.open = false;
    open.querySelector("summary")?.focus();
  });
}

if (typeof document !== "undefined" && document.querySelector("#app-search")) {
  const search = document.querySelector("#app-search");
  const groups = [...document.querySelectorAll("[data-results]")].map((element) => ({
    rows: [...element.querySelectorAll("[data-search]")],
    empty: element.querySelector("[data-empty]"),
  }));

  function filter() {
    for (const { rows, empty } of groups) {
      let found = false;
      for (const row of rows) {
        row.hidden = !matches(row.dataset.search, search.value);
        found ||= !row.hidden;
      }
      empty.hidden = found;
    }
  }

  search.closest("[hidden]").hidden = false;
  search.addEventListener("input", filter);
  window.addEventListener("pageshow", filter);
  filter();
}
