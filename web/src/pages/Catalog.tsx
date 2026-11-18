// SPDX-License-Identifier: Apache-2.0
import { useMemo, useState } from "react";
import { LoadGate, PageTitle, Switch, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, type CatalogApp, type CatalogState, type ChangeResult, type PhoneCatalog } from "../lib/api";
import { usePhone } from "./Phone";
import { Chevron } from "./Phones";

const added = (s: CatalogState) => s === "installed-allowed" || s === "requested";

export function CatalogPage() {
  const { t, locale } = useI18n();
  const { phone, run, pending } = usePhone();
  const res = useLoad(() => api.get<PhoneCatalog>(`/phones/${phone.id}/catalog`), [phone.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const waiting = useMemo(
    () => new Set(pending.flatMap((c) => (c.op.type === "catalog.add" ? [c.op.packageName] : []))),
    [pending],
  );

  async function toggle(app: CatalogApp, on: boolean) {
    setBusy(app.packageName);
    const r = await run(
      () =>
        on
          ? api.post<ChangeResult>(`/phones/${phone.id}/catalog`, { packageName: app.packageName })
          : api.del<ChangeResult>(`/phones/${phone.id}/catalog/${encodeURIComponent(app.packageName)}`),
      t(on ? "catalog.addedNote" : "catalog.removedNote", { app: app.name }),
    );
    if (r) await res.reload();
    setBusy(null);
  }

  function stateText(a: CatalogApp): string {
    switch (a.state) {
      case "installed-allowed":
        return t("catalog.installed");
      case "installed-hidden":
        return t("catalog.installedHidden");
      case "requested":
        return t("catalog.requested");
      case "none":
        return "";
    }
  }

  return (
    <>
      <PageTitle sub={t("catalog.intro")}>{t("catalog.title")}</PageTitle>
      <LoadGate res={res}>
        {(cat) => {
          if (!cat.country || cat.apps.length === 0) return (
            <div className="stack-sm">
              <p className="empty-inline">{t("catalog.empty")}</p>
              <a href="https://github.com/plainphone/plainphone/discussions">{t("catalog.discussions")}</a>
            </div>
          );
          const needle = q.trim().toLocaleLowerCase(locale);
          const shown = needle ? cat.apps.filter((a) => a.name.toLocaleLowerCase(locale).includes(needle)) : cat.apps;
          const groups = cat.categories
            .map((c) => ({ ...c, apps: shown.filter((a) => a.category === c.id).sort((a, b) => a.name.localeCompare(b.name, locale)) }))
            .filter((g) => g.apps.length > 0);
          return (
            <>
              {cat.apps.length > 10 && (
                <div className="field search">
                  <label htmlFor="cat-q">{t("apps.filter")}</label>
                  <input id="cat-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
                </div>
              )}
              {groups.length === 0 && <p className="empty-inline">{t("apps.noMatch", { q })}</p>}
              {groups.map((g) => {
                const n = g.apps.filter((a) => added(a.state)).length;
                return (
                <details key={`${g.id}-${needle ? "q" : ""}`} className="catalog-group" open={needle ? true : undefined}>
                  <summary>
                    <span className="row-main">
                      <span className="row-title">{locale === "da" ? g.name.da : g.name.en}</span>
                      <span className="row-meta">
                        {n > 0 ? t("catalog.countAdded", { n: g.apps.length, added: n }) : t("catalog.count", { n: g.apps.length })}
                      </span>
                    </span>
                    <Chevron />
                  </summary>
                  <ul className="list switch-list">
                    {g.apps.map((a) => (
                      <li key={a.packageName}>
                        <Switch
                          label={a.name}
                          checked={added(a.state)}
                          busy={busy === a.packageName}
                          description={
                            <>
                              {waiting.has(a.packageName) ? (
                                <span className="tag tag-waiting">{t("pending.waitingTag")}</span>
                              ) : (
                                stateText(a)
                              )}
                              {phone.mode === "light" && a.state === "requested" && (
                                <>
                                  {" "}
                                  <a href={a.source} target="_blank" rel="noopener noreferrer" className="play-link">
                                    {t("catalog.openPlay")}
                                    <span className="sr-only">: {a.name}</span>
                                  </a>
                                </>
                              )}
                            </>
                          }
                          onChange={(v) => void toggle(a, v)}
                        />
                      </li>
                    ))}
                  </ul>
                </details>
                );
              })}
              <p className="help catalog-foot">{t(phone.mode === "light" ? "catalog.howLight" : "catalog.howStrong")}</p>
            </>
          );
        }}
      </LoadGate>
    </>
  );
}
