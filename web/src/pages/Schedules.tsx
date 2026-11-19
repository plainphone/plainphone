// SPDX-License-Identifier: Apache-2.0
import { type FormEvent, useId, useRef, useState } from "react";
import { PhoneSwitch, SleepOutsideTip } from "../components/BedtimeSettings";
import { Field, LoadGate, PageTitle, useLoad } from "../components/ui";
import { useI18n } from "../i18n/I18n";
import { api, ApiError, type App, type ChangeResult, type Schedule, type ScheduleInput, type ScheduleKind } from "../lib/api";
import { crossesMidnight, hhmmToMinutes, minutesToHHMM, weekdayName } from "../lib/format";
import { formatDays, formatWindow, kindLabel } from "../lib/ops";
import { usePhone } from "./Phone";

interface Data {
  schedules: Schedule[];
  apps: App[];
}

export function SchedulesPage() {
  const { t, locale } = useI18n();
  const { phone, setPhone, notify, run, appLabel } = usePhone();
  const res = useLoad(async (): Promise<Data> => {
    const [s, a] = await Promise.all([
      api.get<{ schedules: Schedule[] }>(`/phones/${phone.id}/schedules`),
      api.get<{ apps: App[] }>(`/phones/${phone.id}/apps`),
    ]);
    return { schedules: s.schedules, apps: a.apps };
  }, [phone.id]);
  const [editing, setEditing] = useState<Schedule | "new" | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);

  async function remove(s: Schedule) {
    setDeleting(s.id);
    const r = await run(() => api.del<ChangeResult>(`/phones/${phone.id}/schedules/${s.id}`), t("sched.deleted"));
    if (r?.status === "applied") await res.reload();
    setDeleting(null);
    setConfirming(null);
  }

  return (
    <>
      <PageTitle sub={t("sched.intro")}>{t("sched.title")}</PageTitle>
      <SleepOutsideTip />
      <section className="section" aria-label={t("bedtime.silent")}>
        <PhoneSwitch phone={phone} field="silentBedtime" label={t("bedtime.silent")} help={t("bedtime.silentHelp")} setPhone={setPhone} notify={notify} />
      </section>
      <LoadGate res={res}>
        {({ schedules, apps }) => (
          <>
            {schedules.length === 0 && editing === null && <p className="empty-inline">{t("sched.empty")}</p>}
            {schedules.length > 0 && (
              <ul className="list sched-list">
                {schedules.map((s) =>
                  editing !== "new" && editing?.id === s.id ? (
                    <li key={s.id}>
                      <Editor
                        initial={s}
                        apps={apps}
                        onDone={async (saved) => {
                          setEditing(null);
                          if (saved) await res.reload();
                        }}
                      />
                    </li>
                  ) : (
                    <li key={s.id} className="sched">
                      <div className="sched-main">
                        <p className="row-title">{kindLabel(s.kind, t)}</p>
                        <p className="sched-when">
                          {formatDays(s.days, locale, t)}, {formatWindow(s, locale, t)}
                          {crossesMidnight(s.startMinute, s.endMinute) && <span className="muted"> ({t("sched.nextDay").replace(/\.$/, "").toLocaleLowerCase()})</span>}
                        </p>
                        <p className="row-meta">
                          {s.allowedPackages.length === 0
                            ? t("sched.onlyCore")
                            : s.allowedPackages.map(appLabel).join(", ")}
                        </p>
                      </div>
                      {confirming === s.id ? (
                        <div className="sched-actions" role="group" aria-label={t("sched.deleteConfirm", { kind: kindLabel(s.kind, t).toLocaleLowerCase() })}>
                          <span className="confirm-text">{t("sched.deleteConfirm", { kind: kindLabel(s.kind, t).toLocaleLowerCase() })}</span>
                          <button type="button" className="btn btn-danger btn-small" onClick={() => void remove(s)} disabled={deleting === s.id}>
                            {t("app.confirmDelete")}
                          </button>
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirming(null)}>
                            {t("app.cancel")}
                          </button>
                        </div>
                      ) : (
                        <div className="sched-actions">
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditing(s)} disabled={editing !== null}>
                            {t("app.edit")}
                          </button>
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setConfirming(s.id)} disabled={editing !== null}>
                            {t("app.delete")}
                          </button>
                        </div>
                      )}
                    </li>
                  ),
                )}
              </ul>
            )}
            {editing === "new" ? (
              <Editor
                apps={apps}
                onDone={async (saved) => {
                  setEditing(null);
                  if (saved) await res.reload();
                  addRef.current?.focus();
                }}
              />
            ) : (
              <p>
                <button ref={addRef} type="button" className="btn btn-primary" onClick={() => setEditing("new")} disabled={editing !== null}>
                  {t("sched.add")}
                </button>
              </p>
            )}
          </>
        )}
      </LoadGate>
    </>
  );
}

function Editor({ initial, apps, onDone }: { initial?: Schedule; apps: App[]; onDone: (saved: boolean) => void | Promise<void> }) {
  const { t, locale } = useI18n();
  const { phone, run } = usePhone();
  const id = useId();
  const [kind, setKind] = useState<ScheduleKind>(initial?.kind ?? "school");
  const [days, setDays] = useState<Set<number>>(new Set(initial?.days ?? [1, 2, 3, 4, 5]));
  const [start, setStart] = useState(minutesToHHMM(initial?.startMinute ?? 8 * 60));
  const [end, setEnd] = useState(minutesToHHMM(initial?.endMinute ?? 15 * 60));
  const [allowed, setAllowed] = useState<Set<string>>(new Set(initial?.allowedPackages ?? []));
  const [errors, setErrors] = useState<{ days?: string; start?: string; end?: string }>({});
  const [saving, setSaving] = useState(false);
  const reported = new Set(apps.map((app) => app.packageName));
  const existingExceptions = (initial?.allowedPackages ?? [])
    .filter((packageName) => !reported.has(packageName))
    .map((packageName) => ({ packageName, label: packageName }));
  const choosable = [...apps.filter((app) => !app.core), ...existingExceptions]
    .sort((a, b) => a.label.localeCompare(b.label, locale));

  const s = hhmmToMinutes(start);
  const e = hhmmToMinutes(end);
  const nextDay = s !== null && e !== null && s !== e && crossesMidnight(s, e);

  function toggle<T>(set: Set<T>, v: T): Set<T> {
    const n = new Set(set);
    if (n.has(v)) n.delete(v);
    else n.add(v);
    return n;
  }

  function pickKind(k: ScheduleKind) {
    setKind(k);
    // Sensible starting times for a new bedtime; never overwrite an edit.
    if (!initial && k === "bedtime" && start === "08:00" && end === "15:00") {
      setStart("21:00");
      setEnd("07:00");
      setDays(new Set([1, 2, 3, 4, 5, 6, 7]));
    }
  }

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    const next: typeof errors = {};
    if (days.size === 0) next.days = t("sched.noDays");
    if (s === null) next.start = t("sched.badTime");
    if (e === null) next.end = t("sched.badTime");
    if (s !== null && e !== null && s === e) next.end = t("sched.sameTime");
    setErrors(next);
    if (next.days || next.start || next.end) return;
    const body: ScheduleInput = {
      kind,
      days: [...days].sort((a, b) => a - b),
      startMinute: s!,
      endMinute: e!,
      allowedPackages: [...allowed].filter((p) => choosable.some((a) => a.packageName === p)),
    };
    setSaving(true);
    try {
      const r = await run(() =>
        initial
          ? api.put<ChangeResult>(`/phones/${phone.id}/schedules/${initial.id}`, body)
          : api.post<ChangeResult>(`/phones/${phone.id}/schedules`, body),
        t("app.saved"),
      );
      if (r) await onDone(r.status === "applied");
    } catch (err) {
      if (err instanceof ApiError) {
        const f = err.fields();
        setErrors({ days: f.days ? t("sched.noDays") : undefined, end: f[""] || f.endMinute ? t("sched.sameTime") : undefined });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="stack form-card" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="h3">
        {initial ? `${t("sched.editTitle")}: ${kindLabel(initial.kind, t)}` : t("sched.newTitle")}
      </h2>
      <fieldset className="segmented">
        <legend>{t("sched.kind")}</legend>
        {(["school", "bedtime"] as const).map((k) => (
          <label key={k} className="seg">
            <input type="radio" name={`${id}-kind`} value={k} checked={kind === k} onChange={() => pickKind(k)} />
            <span>{kindLabel(k, t)}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className={`days${errors.days ? " field-invalid" : ""}`} aria-describedby={errors.days ? `${id}-days-err` : undefined}>
        <legend>{t("sched.days")}</legend>
        <div className="day-grid">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <label key={d} className="day">
              <input type="checkbox" checked={days.has(d)} onChange={() => setDays(toggle(days, d))} />
              <span aria-hidden="true">{weekdayName(d, locale, "short").replace(/\.$/, "")}</span>
              <span className="sr-only">{weekdayName(d, locale, "long")}</span>
            </label>
          ))}
        </div>
        {errors.days && (
          <p className="field-error" id={`${id}-days-err`}>
            {errors.days}
          </p>
        )}
      </fieldset>
      <div className="time-row">
        <Field label={t("sched.start")} error={errors.start}>
          {(p) => <input {...p} type="time" step={300} value={start} onChange={(ev) => setStart(ev.target.value)} />}
        </Field>
        <Field label={t("sched.end")} error={errors.end}>
          {(p) => <input {...p} type="time" step={300} value={end} onChange={(ev) => setEnd(ev.target.value)} />}
        </Field>
      </div>
      {nextDay && <p className="help">{t("sched.nextDay")}</p>}
      <fieldset className="checks">
        <legend>{t("sched.allowedApps")}</legend>
        <p className="help">{t("sched.allowedHelp")}</p>
        {choosable.length === 0 ? (
          <p className="muted">{t("sched.noApps")}</p>
        ) : (
          <div className="check-grid">
            {choosable.map((a) => (
              <label key={a.packageName} className="check">
                <input type="checkbox" checked={allowed.has(a.packageName)} onChange={() => setAllowed(toggle(allowed, a.packageName))} />
                <span>{a.label}</span>
              </label>
            ))}
          </div>
        )}
      </fieldset>
      <div className="actions">
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? t("app.saving") : t("app.save")}
        </button>
        <button type="button" className="btn btn-secondary" onClick={() => void onDone(false)} disabled={saving}>
          {t("app.cancel")}
        </button>
      </div>
    </form>
  );
}
