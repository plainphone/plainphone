// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useEffect, useId, useMemo, useState } from "react";
import { LoadGate, PageTitle, Switch, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import type { T } from "../i18n/translate";
import { api, type App, type ChangeResult, type Limit, type Locale, type TimeLimits } from "../lib/api";
import { formatMinutes, limitOn, todayIn, weekdayName } from "../lib/format";
import { minuteWords } from "../lib/ops";
import { usePhone } from "./Phone";

/** The durations offered in the pickers. Few, round choices. */
const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240, 300, 360];
const BONUS = 15;
const TOTAL = "*";

interface Data {
  limits: TimeLimits;
  apps: App[];
}

function DurationSelect({
  id,
  value,
  onChange,
  t,
  extra,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  t: T;
  extra?: { value: string; label: string }[];
  describedBy?: string;
}) {
  const w = minuteWords(t);
  // A value set elsewhere (another parent, the API) that is not in the list still shows.
  const options = DURATIONS.includes(Number(value)) || value === "" || isNaN(Number(value)) ? DURATIONS : [...DURATIONS, Number(value)].sort((a, b) => a - b);
  return (
    <select id={id} value={value} onChange={(e) => onChange(e.target.value)} aria-describedby={describedBy}>
      {extra?.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
      {options.map((m) => (
        <option key={m} value={String(m)}>
          {formatMinutes(m, w)}
        </option>
      ))}
    </select>
  );
}

/** "34 min of 2 h used today", with a quiet bar. The text carries the meaning; the bar is decoration. */
function UsedToday({ used, allowed, t }: { used: number | undefined; allowed: number; t: T }) {
  const w = minuteWords(t);
  if (used === undefined) return <p className="help">{t("time.usedUnknown")}</p>;
  const pct = allowed > 0 ? Math.min(100, Math.round((used / allowed) * 100)) : 100;
  const over = used >= allowed;
  return (
    <div className="usage">
      <p className="usage-text">
        {over
          ? t("time.usedUp", { allowed: formatMinutes(allowed, w) })
          : t("time.used", { used: formatMinutes(used, w), allowed: formatMinutes(allowed, w) })}
      </p>
      <div className={`usage-bar${over ? " usage-over" : ""}`} aria-hidden="true">
        <span style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function bonusToday(limits: TimeLimits, pkg: string, date: string): number {
  return limits.bonuses.filter((b) => b.packageName === pkg && b.date === date).reduce((n, b) => n + b.minutes, 0);
}

function daysSummary(limit: Limit, locale: Locale, t: T): string | null {
  const entries = Object.entries(limit.days).filter(([, v]) => v !== undefined) as [string, number][];
  if (entries.length === 0) return null;
  const w = minuteWords(t);
  return entries
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([d, m]) => `${weekdayName(Number(d), locale, "short")} ${m === 0 ? t("time.none").toLocaleLowerCase() : formatMinutes(m, w)}`)
    .join(", ");
}

export function TimePage() {
  const { t } = useI18n();
  const { phone } = usePhone();
  const res = useLoad(async (): Promise<Data> => {
    const [limits, apps] = await Promise.all([
      api.get<TimeLimits>(`/phones/${phone.id}/time-limits`),
      api.get<{ apps: App[] }>(`/phones/${phone.id}/apps`),
    ]);
    return { limits, apps: apps.apps };
  }, [phone.id]);

  return (
    <>
      <PageTitle sub={t("time.intro")}>{t("time.title")}</PageTitle>
      <LoadGate res={res}>
        {(d) => (
          <>
            <TotalSection limits={d.limits} reload={res.reload} />
            <AppsSection limits={d.limits} apps={d.apps} reload={res.reload} />
          </>
        )}
      </LoadGate>
    </>
  );
}

function useWaiting() {
  const { pending } = usePhone();
  return useMemo(
    () =>
      new Set(
        pending.flatMap((c) => (c.op.type === "timeLimit.set" || c.op.type === "timeLimit.bonus" ? [c.op.packageName] : [])),
      ),
    [pending],
  );
}

function WaitingTag() {
  const { t } = useI18n();
  return <span className="tag tag-waiting">{t("pending.waitingTag")}</span>;
}

function TotalSection({ limits, reload }: { limits: TimeLimits; reload: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const { phone, run } = usePhone();
  const waiting = useWaiting();
  const today = todayIn(phone.timezone);
  const current = limits.total;
  const [on, setOn] = useState(current !== null);
  const [minutes, setMinutes] = useState(String(current?.minutes ?? 120));
  const [days, setDays] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries(current?.days ?? {}).map(([k, v]) => [k, String(v)])),
  );
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setOn(current !== null);
    setMinutes(String(current?.minutes ?? 120));
    setDays(Object.fromEntries(Object.entries(current?.days ?? {}).map(([k, v]) => [k, String(v)])));
  }, [current]);

  const draft: Limit | null = on
    ? { minutes: Number(minutes), days: Object.fromEntries(Object.entries(days).filter(([, v]) => v !== "").map(([k, v]) => [k, Number(v)])) }
    : null;
  const dirty = JSON.stringify(draft) !== JSON.stringify(current && { minutes: current.minutes, days: current.days });
  const hasDays = Object.values(days).some((v) => v !== "");

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    await run(
      () =>
        draft
          ? api.put<ChangeResult>(`/phones/${phone.id}/time-limits/total`, draft)
          : api.del<ChangeResult>(`/phones/${phone.id}/time-limits/total`),
      t(draft ? "time.totalSaved" : "time.totalRemoved"),
    );
    await reload();
    setBusy(false);
  }

  async function bonus() {
    setBusy(true);
    await run(
      () => api.post<ChangeResult>(`/phones/${phone.id}/time-limits/bonus`, { packageName: TOTAL, minutes: BONUS }),
      t("time.bonusGiven", { minutes: BONUS }),
    );
    await reload();
    setBusy(false);
  }

  const allowedToday = current ? limitOn(current, today.isoDay) + bonusToday(limits, TOTAL, today.date) : 0;

  return (
    <section className="section" aria-labelledby="total-h">
      <div className="h-row">
        <h2 id="total-h">{t("time.totalTitle")}</h2>
        {waiting.has(TOTAL) && <WaitingTag />}
      </div>
      {current && <UsedToday used={limits.used?.[TOTAL]} allowed={allowedToday} t={t} />}
      <form className="form-card stack time-total-form" onSubmit={(e) => void save(e)}>
        <Switch
          label={t("time.totalSwitch")}
          description={on ? undefined : t("time.totalOff")}
          checked={on}
          onChange={setOn}
        />
        {on && (
          <>
            <div className="field">
              <label htmlFor="total-min">{t("time.perDayLabel")}</label>
              <DurationSelect id="total-min" value={minutes} onChange={setMinutes} t={t} />
            </div>
            <details className="days-details" open={hasDays || undefined}>
              <summary>{t("time.someDays")}</summary>
              <p className="help">{t("time.someDaysHelp")}</p>
              <div className="day-limits">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <div className="day-limit" key={d}>
                    <label htmlFor={`day-${d}`}>{weekdayName(d, locale, "long")}</label>
                    <DurationSelect
                      id={`day-${d}`}
                      value={days[String(d)] ?? ""}
                      onChange={(v) => setDays((x) => ({ ...x, [String(d)]: v }))}
                      t={t}
                      extra={[
                        { value: "", label: t("time.sameAsOther") },
                        { value: "0", label: t("time.none") },
                      ]}
                    />
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
        <div className="actions">
          <button type="submit" className="btn btn-primary" disabled={busy || !dirty}>
            {busy ? t("app.saving") : t("app.save")}
          </button>
          {current && (
            <button type="button" className="btn btn-secondary" onClick={() => void bonus()} disabled={busy}>
              {t("time.bonus", { minutes: BONUS })}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

function AppsSection({ limits, apps, reload }: { limits: TimeLimits; apps: App[]; reload: () => Promise<void> }) {
  const { t, locale } = useI18n();
  const listId = useId();
  const { phone, run } = usePhone();
  const waiting = useWaiting();
  const w = minuteWords(t);
  const today = todayIn(phone.timezone);
  const [editing, setEditing] = useState<string | null>(null);
  const [editMinutes, setEditMinutes] = useState("60");
  const [busy, setBusy] = useState<string | null>(null);
  const limited = new Set(limits.apps.map((a) => a.packageName));
  const candidates = apps
    .filter((a) => !a.core && a.allowed && !limited.has(a.packageName))
    .sort((a, b) => a.label.localeCompare(b.label, locale));
  const [pick, setPick] = useState("");
  const [pickMinutes, setPickMinutes] = useState("60");
  const chosen = candidates.some((a) => a.packageName === pick) ? pick : (candidates[0]?.packageName ?? "");

  async function act(key: string, fn: () => Promise<ChangeResult>, text: string) {
    setBusy(key);
    await run(fn, text);
    await reload();
    setBusy(null);
  }

  const path = (pkg: string) => `/phones/${phone.id}/time-limits/apps/${encodeURIComponent(pkg)}`;

  return (
    <section className="section" aria-labelledby="apps-h">
      <h2 id="apps-h">{t("time.appsTitle")}</h2>
      <p className="help">{t("time.appsHelp")}</p>
      {limits.apps.length > 0 && (
        <ul className="list">
          {limits.apps.map((a) => {
            const allowed = limitOn(a.limit, today.isoDay) + bonusToday(limits, a.packageName, today.date);
            const used = limits.used?.[a.packageName];
            const isEditing = editing === a.packageName;
            const rowId = `${listId}-${a.packageName}`;
            return (
              <li key={a.packageName} className="limit-item">
                <div className="limit-head">
                  <div className="limit-main">
                    <p className="row-title">
                      <span id={`${rowId}-app`}>{a.label}</span>
                      {waiting.has(a.packageName) && <WaitingTag />}
                    </p>
                    <p className="row-meta">
                      {t("time.perDay", { time: formatMinutes(a.limit.minutes, w) })}
                      {daysSummary(a.limit, locale, t) && `, ${daysSummary(a.limit, locale, t)}`}
                    </p>
                    {used !== undefined && (
                      <p className="row-meta">{t("time.usedShort", { used: formatMinutes(used, w), allowed: formatMinutes(allowed, w) })}</p>
                    )}
                  </div>
                  {!isEditing && (
                    <div className="sched-actions">
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        disabled={busy === a.packageName}
                        id={`${rowId}-bonus`}
                        aria-labelledby={`${rowId}-bonus ${rowId}-app`}
                        onClick={() =>
                          void act(
                            a.packageName,
                            () => api.post<ChangeResult>(`/phones/${phone.id}/time-limits/bonus`, { packageName: a.packageName, minutes: BONUS }),
                            t("time.bonusGivenApp", { minutes: BONUS, app: a.label }),
                          )
                        }
                      >
                        {t("time.bonus", { minutes: BONUS })}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary btn-small"
                        id={`${rowId}-edit`}
                        aria-labelledby={`${rowId}-edit ${rowId}-app`}
                        onClick={() => {
                          setEditing(a.packageName);
                          setEditMinutes(String(a.limit.minutes));
                        }}
                      >
                        {t("app.edit")}
                      </button>
                    </div>
                  )}
                </div>
                {isEditing && (
                  <form
                    className="inline-form limit-edit"
                    onSubmit={(e) => {
                      e.preventDefault();
                      setEditing(null);
                      void act(
                        a.packageName,
                        () => api.put<ChangeResult>(path(a.packageName), { minutes: Number(editMinutes), days: a.limit.days }),
                        t("time.appSaved", { app: a.label }),
                      );
                    }}
                  >
                    <div className="field">
                      <label htmlFor={`edit-${a.packageName}`}>{t("time.perDayLabel")}</label>
                      <DurationSelect id={`edit-${a.packageName}`} value={editMinutes} onChange={setEditMinutes} t={t} />
                    </div>
                    <button type="submit" className="btn btn-primary">
                      {t("app.save")}
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary"
                      onClick={() => {
                        setEditing(null);
                        void act(a.packageName, () => api.del<ChangeResult>(path(a.packageName)), t("time.appRemoved", { app: a.label }));
                      }}
                    >
                      {t("time.removeLimit")}
                    </button>
                    <button type="button" className="btn-link" onClick={() => setEditing(null)}>
                      {t("app.cancel")}
                    </button>
                  </form>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {candidates.length > 0 ? (
        <form
          className="inline-form form-card"
          onSubmit={(e) => {
            e.preventDefault();
            const app = candidates.find((a) => a.packageName === chosen);
            if (!app) return;
            void act(
              "add",
              () => api.put<ChangeResult>(path(app.packageName), { minutes: Number(pickMinutes), days: {} }),
              t("time.appSaved", { app: app.label }),
            );
          }}
        >
          <div className="field">
            <label htmlFor="limit-app">{t("time.app")}</label>
            <select id="limit-app" value={chosen} onChange={(e) => setPick(e.target.value)}>
              {candidates.map((a) => (
                <option key={a.packageName} value={a.packageName}>
                  {a.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field field-short">
            <label htmlFor="limit-min">{t("time.perDayLabel")}</label>
            <DurationSelect id="limit-min" value={pickMinutes} onChange={setPickMinutes} t={t} />
          </div>
          <button type="submit" className="btn btn-primary" disabled={busy === "add"}>
            {t("time.addLimit")}
          </button>
        </form>
      ) : (
        limits.apps.length === 0 && <p className="empty-inline">{t("time.noApps")}</p>
      )}
    </section>
  );
}
