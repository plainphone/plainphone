// SPDX-License-Identifier: Apache-2.0
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { LoadGate, PageTitle, Switch, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, type App, type ChangeResult } from "../lib/api";
import { usePhone } from "./Phone";
import { Chevron } from "./Phones";

export function AppsPage() {
  const { t, locale } = useI18n();
  const { phone, run, setApps, pending } = usePhone();
  const res = useLoad(() => api.get<{ apps: App[] }>(`/phones/${phone.id}/apps`).then((r) => r.apps), [phone.id]);
  const [busy, setBusy] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    if (res.data) setApps(res.data);
  }, [res.data, setApps]);

  const waiting = useMemo(
    () => new Set(pending.flatMap((c) => (c.op.type === "app.set" ? [c.op.packageName] : []))),
    [pending],
  );

  async function toggle(app: App, allowed: boolean) {
    setBusy(app.packageName);
    const r = await run(
      () => api.put<ChangeResult>(`/phones/${phone.id}/apps/${encodeURIComponent(app.packageName)}`, { allowed }),
      t(allowed ? "apps.shown" : "apps.hidden", { app: app.label }),
    );
    if (r?.status === "applied") {
      res.setData((list) => list?.map((a) => (a.packageName === app.packageName ? { ...a, allowed } : a)));
    }
    setBusy(null);
  }

  return (
    <>
      <div className="title-row apps-heading">
        <PageTitle sub={t("apps.intro")}>{t("apps.title")}</PageTitle>
        <Link to={`/phones/${phone.id}/apps/add`} className="btn btn-secondary">
          {t("catalog.entry")}
          <Chevron />
        </Link>
      </div>
      <LoadGate res={res}>
        {(apps) => {
          if (apps.length === 0) return <p className="empty-inline">{t("apps.empty")}</p>;
          const needle = q.trim().toLocaleLowerCase(locale);
          const shown = needle ? apps.filter((a) => a.label.toLocaleLowerCase(locale).includes(needle)) : apps;
          const sorted = [...shown].sort((a, b) => Number(b.core) - Number(a.core) || a.label.localeCompare(b.label, locale));
          return (
            <>
              {apps.length > 10 && (
                <div className="field search">
                  <label htmlFor="app-q">{t("apps.filter")}</label>
                  <input id="app-q" type="search" value={q} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
                </div>
              )}
              <p role="status" className={sorted.length === 0 ? "empty-inline" : "sr-only"}>
                {sorted.length === 0 ? t("apps.noMatch", { q }) : ""}
              </p>
              {sorted.length > 0 && (
                <ul className="list switch-list">
                  {sorted.map((a) => (
                    <li key={a.packageName}>
                      <Switch
                        label={a.label}
                        checked={a.allowed || a.core}
                        disabled={a.core}
                        busy={busy === a.packageName}
                        description={
                          a.core ? (
                            t("apps.core")
                          ) : waiting.has(a.packageName) ? (
                            <span className="tag tag-waiting">{t("pending.waitingTag")}</span>
                          ) : undefined
                        }
                        onChange={(v) => void toggle(a, v)}
                      />
                    </li>
                  ))}
                </ul>
              )}
              <p className="help">{t("apps.coreHelp")}</p>
            </>
          );
        }}
      </LoadGate>
    </>
  );
}
